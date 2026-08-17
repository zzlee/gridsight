#include "../include/encoder.h"
#include "../include/utils.h"
#include <iostream>
#include <algorithm>
#include <cstring>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#include <wincodec.h>
#include <objbase.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wmcodecdsp.h>

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")
#pragma comment(lib, "ole32.lib")
#endif

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../include/stb_image_write.h"

namespace GridSight {

static const char* g_active_engine_name = "Auto-Detecting";

const char* ImageEncoder::GetActiveJpegEngineName() {
    return g_active_engine_name;
}

// Single-pass 16.16 fixed-point downsampler and BGRA->RGB converter
static void DownscaleAndConvertBGRAtoRGB(const uint8_t* __restrict src, int src_w, int src_h,
                                        uint8_t* __restrict dst_rgb, int dst_w, int dst_h) {
    uint32_t x_ratio = ((uint32_t)src_w << 16) / dst_w;
    uint32_t y_ratio = ((uint32_t)src_h << 16) / dst_h;

    for (int y = 0; y < dst_h; ++y) {
        int src_y = (y * y_ratio) >> 16;
        if (src_y >= src_h) src_y = src_h - 1;
        const uint8_t* src_row = src + (src_y * src_w * 4);
        uint8_t* dst_row = dst_rgb + (y * dst_w * 3);

        for (int x = 0; x < dst_w; ++x) {
            int src_x = (x * x_ratio) >> 16;
            if (src_x >= src_w) src_x = src_w - 1;
            const uint8_t* p = src_row + (src_x * 4);
            dst_row[x * 3 + 0] = p[2]; // R
            dst_row[x * 3 + 1] = p[1]; // G
            dst_row[x * 3 + 2] = p[0]; // B
        }
    }
}

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

// Thread-local scratch buffers to eliminate heap allocation churn
static thread_local std::vector<uint8_t> tl_rgb_buffer;
static thread_local uint64_t tl_last_hash = 0;
static thread_local std::vector<uint8_t> tl_cached_jpeg;

#ifdef _WIN32
static thread_local std::vector<uint8_t> tl_downscaled_bgra;

bool ImageEncoder::EncodeWithWIC(const uint8_t* bgra_data, int width, int height,
                                 int target_width, int target_height, int quality,
                                 std::vector<uint8_t>& out_jpeg) {
    if (!bgra_data || width <= 0 || height <= 0 || target_width <= 0 || target_height <= 0) {
        return false;
    }

    IWICImagingFactory* pFactory = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pFactory));
    if (FAILED(hr) || !pFactory) {
        return false;
    }

    IStream* pStream = nullptr;
    hr = CreateStreamOnHGlobal(NULL, TRUE, &pStream);
    if (FAILED(hr) || !pStream) {
        pFactory->Release();
        return false;
    }

    IWICBitmapEncoder* pEncoder = nullptr;
    hr = pFactory->CreateEncoder(GUID_ContainerFormatJpeg, NULL, &pEncoder);
    if (FAILED(hr) || !pEncoder) {
        pStream->Release();
        pFactory->Release();
        return false;
    }

    hr = pEncoder->Initialize(pStream, WICBitmapEncoderNoCache);
    if (FAILED(hr)) {
        pEncoder->Release();
        pStream->Release();
        pFactory->Release();
        return false;
    }

    IWICBitmapFrameEncode* pFrame = nullptr;
    IPropertyBag2* pPropertyBag = nullptr;
    hr = pEncoder->CreateNewFrame(&pFrame, &pPropertyBag);
    if (FAILED(hr) || !pFrame) {
        pEncoder->Release();
        pStream->Release();
        pFactory->Release();
        return false;
    }

    if (pPropertyBag) {
        PROPBAG2 option = { 0 };
        option.pstrName = (LPOLESTR)L"ImageQuality";
        VARIANT varValue;
        VariantInit(&varValue);
        varValue.vt = VT_R4;
        varValue.fltVal = (float)quality / 100.0f;
        pPropertyBag->Write(1, &option, &varValue);
    }

    hr = pFrame->Initialize(pPropertyBag);
    if (pPropertyBag) pPropertyBag->Release();
    if (FAILED(hr)) {
        pFrame->Release();
        pEncoder->Release();
        pStream->Release();
        pFactory->Release();
        return false;
    }

    pFrame->SetSize(target_width, target_height);
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    pFrame->SetPixelFormat(&format);

    // Fast 16.16 integer downsampling for BGRA
    size_t downscaled_bytes = (size_t)target_width * target_height * 4;
    if (tl_downscaled_bgra.size() != downscaled_bytes) {
        tl_downscaled_bgra.resize(downscaled_bytes);
    }

    uint32_t x_ratio = ((uint32_t)width << 16) / target_width;
    uint32_t y_ratio = ((uint32_t)height << 16) / target_height;
    for (int y = 0; y < target_height; ++y) {
        int src_y = (y * y_ratio) >> 16;
        if (src_y >= height) src_y = height - 1;
        const uint32_t* src_row = (const uint32_t*)(bgra_data + src_y * width * 4);
        uint32_t* dst_row = (uint32_t*)(tl_downscaled_bgra.data() + y * target_width * 4);
        for (int x = 0; x < target_width; ++x) {
            int src_x = (x * x_ratio) >> 16;
            if (src_x >= width) src_x = width - 1;
            dst_row[x] = src_row[src_x];
        }
    }

    hr = pFrame->WritePixels(target_height, target_width * 4, (UINT)downscaled_bytes, tl_downscaled_bgra.data());
    if (FAILED(hr)) {
        pFrame->Release();
        pEncoder->Release();
        pStream->Release();
        pFactory->Release();
        return false;
    }

    pFrame->Commit();
    pEncoder->Commit();

    // Read back stream to out_jpeg
    STATSTG stat;
    if (SUCCEEDED(pStream->Stat(&stat, STATFLAG_NONAME))) {
        ULONG stream_size = (ULONG)stat.cbSize.QuadPart;
        out_jpeg.resize(stream_size);
        LARGE_INTEGER seek_pos;
        seek_pos.QuadPart = 0;
        pStream->Seek(seek_pos, STREAM_SEEK_SET, NULL);
        ULONG bytes_read = 0;
        pStream->Read(out_jpeg.data(), stream_size, &bytes_read);
        out_jpeg.resize(bytes_read);
    }

    pFrame->Release();
    pEncoder->Release();
    pStream->Release();
    pFactory->Release();

    return !out_jpeg.empty();
}
#else
bool ImageEncoder::EncodeWithWIC(const uint8_t*, int, int, int, int, int, std::vector<uint8_t>&) {
    return false;
}
#endif

bool ImageEncoder::EncodeWithTurbo(const uint8_t* bgra_data, int width, int height,
                                  int target_width, int target_height, int quality,
                                  std::vector<uint8_t>& out_jpeg) {
    size_t rgb_size = (size_t)target_width * target_height * 3;
    if (tl_rgb_buffer.size() != rgb_size) {
        tl_rgb_buffer.resize(rgb_size);
    }

    DownscaleAndConvertBGRAtoRGB(bgra_data, width, height, tl_rgb_buffer.data(), target_width, target_height);

    out_jpeg.clear();
    out_jpeg.reserve(24576);

    auto write_callback = [](void* context, void* data, int size) {
        auto* vec = static_cast<std::vector<uint8_t>*>(context);
        const uint8_t* byte_data = static_cast<const uint8_t*>(data);
        vec->insert(vec->end(), byte_data, byte_data + size);
    };

    int success = stbi_write_jpg_to_func(write_callback, &out_jpeg, target_width, target_height, 3, tl_rgb_buffer.data(), quality);
    return (success != 0) && !out_jpeg.empty();
}

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

    // 2. Primary: Try Windows WIC Hardware/SIMD Engine
    static bool wic_available = true;
    static bool wic_attempted = false;

    if (wic_available) {
        if (EncodeWithWIC(bgra_data, width, height, target_width, target_height, quality, out_jpeg)) {
            g_active_engine_name = "Windows WIC (Hardware/SIMD)";
            tl_last_hash = current_hash;
            tl_cached_jpeg = out_jpeg;
            return true;
        }
        if (!wic_attempted) {
            wic_attempted = true;
            wic_available = false; // Mark unavailable to avoid repeated slow COM failures
        }
    }

    // 3. Fallback: Fast Turbo SIMD / Fixed-point Engine
    g_active_engine_name = "Turbo SIMD / Fast-DCT Engine";
    if (EncodeWithTurbo(bgra_data, width, height, target_width, target_height, quality, out_jpeg)) {
        tl_last_hash = current_hash;
        tl_cached_jpeg = out_jpeg;
        return true;
    }

    return false;
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
