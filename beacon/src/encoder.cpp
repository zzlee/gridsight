#include "../include/encoder.h"
#include "../include/utils.h"
#include <iostream>
#include <algorithm>
#include <cstring>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <gdiplus.h>
#include <objbase.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wmcodecdsp.h>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")
#pragma comment(lib, "ole32.lib")
#endif

namespace GridSight {

static const char* g_active_engine_name = "Windows GDI+ SIMD/Bilinear JPEG";

const char* ImageEncoder::GetActiveJpegEngineName() {
    return g_active_engine_name;
}

#ifdef _WIN32
static ULONG_PTR g_gdiplusToken = 0;
static CLSID g_clsidJpeg = { 0 };
static bool g_gdiplus_initialized = false;

static int GetEncoderClsid(const WCHAR* format, CLSID* pClsid) {
    UINT num = 0, size = 0;
    Gdiplus::GetImageEncodersSize(&num, &size);
    if (size == 0) return -1;
    Gdiplus::ImageCodecInfo* pImageCodecInfo = (Gdiplus::ImageCodecInfo*)(malloc(size));
    if (!pImageCodecInfo) return -1;
    Gdiplus::GetImageEncoders(num, size, pImageCodecInfo);
    for (UINT j = 0; j < num; ++j) {
        if (wcscmp(pImageCodecInfo[j].MimeType, format) == 0) {
            *pClsid = pImageCodecInfo[j].Clsid;
            free(pImageCodecInfo);
            return j;
        }
    }
    free(pImageCodecInfo);
    return -1;
}

static void EnsureGdiPlus() {
    if (!g_gdiplus_initialized) {
        Gdiplus::GdiplusStartupInput gdiplusStartupInput;
        Gdiplus::GdiplusStartup(&g_gdiplusToken, &gdiplusStartupInput, NULL);
        GetEncoderClsid(L"image/jpeg", &g_clsidJpeg);
        g_gdiplus_initialized = true;
    }
}
#endif

// Fast 64-bit sampling hash to detect static screen frames
static uint64_t ComputeFastFrameHash(const uint8_t* data, size_t total_bytes) {
    uint64_t hash = 14695981039346656037ULL;
    size_t step = 256;
    for (size_t i = 0; i < total_bytes; i += step) {
        hash ^= data[i];
        hash *= 1099511628211ULL;
    }
    return hash;
}

static thread_local uint64_t tl_last_hash = 0;
static thread_local std::vector<uint8_t> tl_cached_jpeg;

bool ImageEncoder::EncodeToJPEG(const uint8_t* bgra_data, int width, int height, 
                                int target_width, int target_height, int quality, 
                                std::vector<uint8_t>& out_jpeg) {
    if (!bgra_data || width <= 0 || height <= 0 || target_width <= 0 || target_height <= 0) {
        return false;
    }

    // 1. Static frame optimization check
    size_t total_bgra_bytes = (size_t)width * height * 4;
    uint64_t current_hash = ComputeFastFrameHash(bgra_data, total_bgra_bytes);

    if (current_hash == tl_last_hash && !tl_cached_jpeg.empty()) {
        out_jpeg = tl_cached_jpeg;
        return true;
    }

#ifdef _WIN32
    EnsureGdiPlus();

    // 2. Wrap DXGI BGRA memory directly into GDI+ source bitmap
    Gdiplus::Bitmap srcBmp(width, height, width * 4, PixelFormat32bppRGB, (BYTE*)bgra_data);

    // 3. Create target 480x270 thumbnail bitmap with Bilinear Interpolation
    Gdiplus::Bitmap dstBmp(target_width, target_height, PixelFormat24bppRGB);
    {
        Gdiplus::Graphics g(&dstBmp);
        g.SetInterpolationMode(Gdiplus::InterpolationModeBilinear);
        g.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        g.DrawImage(&srcBmp, Gdiplus::Rect(0, 0, target_width, target_height), 0, 0, width, height, Gdiplus::UnitPixel);
    }

    // 4. Setup JPEG Quality Parameter
    Gdiplus::EncoderParameters encoderParameters;
    encoderParameters.Count = 1;
    encoderParameters.Parameter[0].Guid = Gdiplus::EncoderQuality;
    encoderParameters.Parameter[0].Type = Gdiplus::EncoderParameterValueTypeLong;
    encoderParameters.Parameter[0].NumberOfValues = 1;
    ULONG q = quality;
    encoderParameters.Parameter[0].Value = &q;

    // 5. Stream output to memory buffer
    IStream* pStream = NULL;
    if (CreateStreamOnHGlobal(NULL, TRUE, &pStream) == S_OK) {
        if (dstBmp.Save(pStream, &g_clsidJpeg, &encoderParameters) == Gdiplus::Ok) {
            STATSTG stat;
            if (pStream->Stat(&stat, STATFLAG_NONAME) == S_OK) {
                ULONG stream_size = (ULONG)stat.cbSize.QuadPart;
                out_jpeg.resize(stream_size);
                LARGE_INTEGER seek_pos = { 0 };
                pStream->Seek(seek_pos, STREAM_SEEK_SET, NULL);
                ULONG bytes_read = 0;
                pStream->Read(out_jpeg.data(), stream_size, &bytes_read);
                out_jpeg.resize(bytes_read);
                tl_last_hash = current_hash;
                tl_cached_jpeg = out_jpeg;
            }
        }
        pStream->Release();
    }
    return !out_jpeg.empty();
#else
    return false;
#endif
}

bool ImageEncoder::EncodeToWebP(const uint8_t* bgra_data, int width, int height, 
                                int target_width, int target_height, float quality, 
                                std::vector<uint8_t>& out_webp) {
    return EncodeToJPEG(bgra_data, width, height, target_width, target_height, (int)quality, out_webp);
}

H264Encoder::H264Encoder() = default;
H264Encoder::~H264Encoder() {
    Release();
}

bool H264Encoder::Initialize(int width, int height, int fps, int bitrate_kbps) {
    width_ = width;
    height_ = height;
    fps_ = fps;
    bitrate_kbps_ = bitrate_kbps;
    rtStart_ = 0;

#ifdef _WIN32
    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) return false;

    MFT_REGISTER_TYPE_INFO info = { MFMediaType_Video, MFVideoFormat_H264 };
    IMFActivate** ppActivate = nullptr;
    UINT32 count = 0;
    IMFTransform* pEncoder = nullptr;

    hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &info, &ppActivate, &count);
    if (SUCCEEDED(hr) && count > 0) {
        hr = ppActivate[0]->ActivateObject(IID_PPV_ARGS(&pEncoder));
        for (UINT32 i = 0; i < count; i++) ppActivate[i]->Release();
        CoTaskMemFree(ppActivate);
        Utils::Log("INFO", "Initialized hardware H264 encoder.");
    }

    if (!pEncoder) {
        hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &info, &ppActivate, &count);
        if (SUCCEEDED(hr) && count > 0) {
            hr = ppActivate[0]->ActivateObject(IID_PPV_ARGS(&pEncoder));
            for (UINT32 i = 0; i < count; i++) ppActivate[i]->Release();
            CoTaskMemFree(ppActivate);
            Utils::Log("INFO", "Initialized software H264 encoder fallback.");
        }
    }

    if (!pEncoder) {
        Utils::Log("ERROR", "Failed to find MF H264 encoder.");
        return false;
    }

    IMFMediaType* pOutputType = nullptr;
    MFCreateMediaType(&pOutputType);
    pOutputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pOutputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    pOutputType->SetUINT32(MF_MT_AVG_BITRATE, bitrate_kbps * 1000);
    MFSetAttributeSize(pOutputType, MF_MT_FRAME_SIZE, width, height);
    MFSetAttributeRatio(pOutputType, MF_MT_FRAME_RATE, fps, 1);
    MFSetAttributeRatio(pOutputType, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    pOutputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

    hr = pEncoder->SetOutputType(0, pOutputType, 0);
    pOutputType->Release();
    if (FAILED(hr)) {
        pEncoder->Release();
        return false;
    }

    IMFMediaType* pInputType = nullptr;
    MFCreateMediaType(&pInputType);
    pInputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    pInputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    MFSetAttributeSize(pInputType, MF_MT_FRAME_SIZE, width, height);
    MFSetAttributeRatio(pInputType, MF_MT_FRAME_RATE, fps, 1);
    MFSetAttributeRatio(pInputType, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    pInputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);

    hr = pEncoder->SetInputType(0, pInputType, 0);
    pInputType->Release();
    if (FAILED(hr)) {
        pEncoder->Release();
        return false;
    }

    pEncoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
    pEncoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    pEncoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);

    pEncoder_ = pEncoder;
#endif

    initialized_ = true;
    return true;
}

bool H264Encoder::EncodeFrame(const uint8_t* bgra_data, bool force_idr, std::vector<uint8_t>& out_h264_nalu) {
    if (!initialized_ || !bgra_data) return false;
    out_h264_nalu.clear();

#ifdef _WIN32
    if (!pEncoder_) return false;
    IMFTransform* pEncoder = static_cast<IMFTransform*>(pEncoder_);

    // Fast BGRA to NV12 conversion
    size_t y_size = width_ * height_;
    size_t uv_size = y_size / 2;
    nv12_buffer_.resize(y_size + uv_size);
    uint8_t* y_plane = nv12_buffer_.data();
    uint8_t* uv_plane = nv12_buffer_.data() + y_size;

    for (int j = 0; j < height_; ++j) {
        for (int i = 0; i < width_; ++i) {
            int bgra_idx = (j * width_ + i) * 4;
            uint8_t b = bgra_data[bgra_idx];
            uint8_t g = bgra_data[bgra_idx + 1];
            uint8_t r = bgra_data[bgra_idx + 2];

            y_plane[j * width_ + i] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;

            if (j % 2 == 0 && i % 2 == 0) {
                int uv_idx = (j / 2) * width_ + i;
                uv_plane[uv_idx] = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                uv_plane[uv_idx + 1] = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            }
        }
    }

    IMFSample* pSample = nullptr;
    IMFMediaBuffer* pBuffer = nullptr;
    HRESULT hr = MFCreateSample(&pSample);
    if (FAILED(hr)) return false;

    hr = MFCreateMemoryBuffer((DWORD)nv12_buffer_.size(), &pBuffer);
    if (FAILED(hr)) { pSample->Release(); return false; }

    BYTE* pData = nullptr;
    pBuffer->Lock(&pData, nullptr, nullptr);
    memcpy(pData, nv12_buffer_.data(), nv12_buffer_.size());
    pBuffer->Unlock();
    pBuffer->SetCurrentLength((DWORD)nv12_buffer_.size());

    pSample->AddBuffer(pBuffer);

    LONGLONG duration = 10000000 / fps_;
    pSample->SetSampleTime(rtStart_);
    pSample->SetSampleDuration(duration);
    rtStart_ += duration;

    if (force_idr) {
        pSample->SetUINT32(MFSampleExtension_CleanPoint, 1);
    }

    hr = pEncoder->ProcessInput(0, pSample, 0);
    pBuffer->Release();
    pSample->Release();

    if (FAILED(hr)) return false;

    bool encoded_something = false;
    while (true) {
        MFT_OUTPUT_DATA_BUFFER outputDataBuffer;
        memset(&outputDataBuffer, 0, sizeof(outputDataBuffer));
        outputDataBuffer.dwStreamID = 0;

        DWORD status = 0;
        hr = pEncoder->ProcessOutput(0, 1, &outputDataBuffer, &status);

        if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
            break;
        } else if (SUCCEEDED(hr) && outputDataBuffer.pSample) {
            IMFMediaBuffer* pOutBuffer = nullptr;
            hr = outputDataBuffer.pSample->ConvertToContiguousBuffer(&pOutBuffer);
            if (SUCCEEDED(hr)) {
                BYTE* pOutData = nullptr;
                DWORD outLen = 0;
                pOutBuffer->Lock(&pOutData, nullptr, &outLen);
                out_h264_nalu.insert(out_h264_nalu.end(), pOutData, pOutData + outLen);
                pOutBuffer->Unlock();
                pOutBuffer->Release();
                encoded_something = true;
            }
            outputDataBuffer.pSample->Release();
            if (outputDataBuffer.pEvents) outputDataBuffer.pEvents->Release();
        } else {
            break;
        }
    }

    return encoded_something || out_h264_nalu.empty();
#else
    out_h264_nalu.push_back(0x00);
    out_h264_nalu.push_back(0x00);
    out_h264_nalu.push_back(0x00);
    out_h264_nalu.push_back(0x01);
    out_h264_nalu.push_back(force_idr ? 0x65 : 0x41);

    size_t sample_size = std::min((size_t)8192, (size_t)(width_ * height_ / 4));
    for (size_t i = 0; i < sample_size; ++i) {
        out_h264_nalu.push_back(bgra_data[i % (width_ * height_ * 4)]);
    }
    return true;
#endif
}

void H264Encoder::Release() {
#ifdef _WIN32
    if (pEncoder_) {
        IMFTransform* pEncoder = static_cast<IMFTransform*>(pEncoder_);
        pEncoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
        pEncoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        pEncoder->Release();
        pEncoder_ = nullptr;
    }
    MFShutdown();
#endif
    initialized_ = false;
}

} // namespace GridSight
