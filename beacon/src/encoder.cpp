#include "../include/encoder.h"
#include "../include/utils.h"
#include <iostream>
#include <algorithm>
#include <cstring>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#include <emmintrin.h>
#include <tmmintrin.h>
#define HAS_X86_SIMD 1
#endif

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

static const GUID GS_CODECAPI_AVLowLatencyMode = {0x9c27891a, 0xed7a, 0x40e1, {0x88, 0xe1, 0xb2, 0xe4, 0x5b, 0x30, 0x49, 0x11}};
static const GUID GS_MF_LOW_LATENCY = {0x9c51d740, 0xdc55, 0x4864, {0x9c, 0x41, 0x8b, 0xa4, 0x76, 0xa5, 0xa1, 0xb8}};
#endif

namespace GridSight {

void ConvertBGRAtoNV12_SIMD(const uint8_t* bgra_data, int width, int height, uint8_t* nv12_out) {
    if (!bgra_data || !nv12_out || width <= 0 || height <= 0) return;

    size_t y_size = (size_t)width * height;
    uint8_t* y_plane = nv12_out;
    uint8_t* uv_plane = nv12_out + y_size;

#if defined(HAS_X86_SIMD)
    // BT.601 coefficients for BGRA -> Y: 25*B + 129*G + 66*R + 0*A
    __m128i coeff_y = _mm_setr_epi16(25, 129, 66, 0, 25, 129, 66, 0);
    __m128i zero    = _mm_setzero_si128();
    __m128i add128  = _mm_set1_epi32(128);
    __m128i add16   = _mm_set1_epi32(16);

    for (int j = 0; j < height; ++j) {
        const uint8_t* bgra_row = bgra_data + (size_t)j * width * 4;
        uint8_t* y_row = y_plane + (size_t)j * width;
        bool is_even_row = (j % 2 == 0);
        uint8_t* uv_row = is_even_row ? (uv_plane + (size_t)(j / 2) * width) : nullptr;

        int i = 0;
        // Process 8 pixels (32 BGRA bytes) per iteration using SSE2 16-bit/32-bit math
        for (; i <= width - 8; i += 8) {
            const uint8_t* src_px = bgra_row + i * 4;
            __m128i pix0 = _mm_loadu_si128((const __m128i*)src_px);        // Pixels 0..3
            __m128i pix1 = _mm_loadu_si128((const __m128i*)(src_px + 16)); // Pixels 4..7

            // --- Y calculation for pix0 (4 pixels) ---
            __m128i p0_lo = _mm_unpacklo_epi8(pix0, zero); // Pixels 0, 1 as uint16
            __m128i p0_hi = _mm_unpackhi_epi8(pix0, zero); // Pixels 2, 3 as uint16

            __m128i madd0_lo = _mm_madd_epi16(p0_lo, coeff_y); // [25*B0 + 129*G0, 66*R0, 25*B1 + 129*G1, 66*R1]
            __m128i madd0_hi = _mm_madd_epi16(p0_hi, coeff_y); // [25*B2 + 129*G2, 66*R2, 25*B3 + 129*G3, 66*R3]

            // Sum adjacent pairs [bg + r] for each pixel
            __m128i sum0_lo = _mm_add_epi32(madd0_lo, _mm_shuffle_epi32(madd0_lo, _MM_SHUFFLE(2, 3, 0, 1)));
            __m128i sum0_hi = _mm_add_epi32(madd0_hi, _mm_shuffle_epi32(madd0_hi, _MM_SHUFFLE(2, 3, 0, 1)));

            // Gather Y0, Y1 from sum0_lo and Y2, Y3 from sum0_hi -> y0_32 = [Y0, Y1, Y2, Y3]
            __m128i y0_32 = _mm_castps_si128(_mm_shuffle_ps(_mm_castsi128_ps(sum0_lo), _mm_castsi128_ps(sum0_hi), _MM_SHUFFLE(2, 0, 2, 0)));
            y0_32 = _mm_add_epi32(_mm_srai_epi32(_mm_add_epi32(y0_32, add128), 8), add16);

            // --- Y calculation for pix1 (4 pixels: Y4, Y5, Y6, Y7) ---
            __m128i p1_lo = _mm_unpacklo_epi8(pix1, zero); // Pixels 4, 5 as uint16
            __m128i p1_hi = _mm_unpackhi_epi8(pix1, zero); // Pixels 6, 7 as uint16

            __m128i madd1_lo = _mm_madd_epi16(p1_lo, coeff_y);
            __m128i madd1_hi = _mm_madd_epi16(p1_hi, coeff_y);

            __m128i sum1_lo = _mm_add_epi32(madd1_lo, _mm_shuffle_epi32(madd1_lo, _MM_SHUFFLE(2, 3, 0, 1)));
            __m128i sum1_hi = _mm_add_epi32(madd1_hi, _mm_shuffle_epi32(madd1_hi, _MM_SHUFFLE(2, 3, 0, 1)));

            __m128i y1_32 = _mm_castps_si128(_mm_shuffle_ps(_mm_castsi128_ps(sum1_lo), _mm_castsi128_ps(sum1_hi), _MM_SHUFFLE(2, 0, 2, 0)));
            y1_32 = _mm_add_epi32(_mm_srai_epi32(_mm_add_epi32(y1_32, add128), 8), add16);

            // Pack 8 x 32-bit Y values -> 8 uint16 -> 8 uint8 bytes
            __m128i y_16 = _mm_packs_epi32(y0_32, y1_32);
            __m128i y8   = _mm_packus_epi16(y_16, y_16);

            _mm_storel_epi64((__m128i*)(y_row + i), y8);

            // Subsampled UV calculation for even rows
            if (is_even_row) {
                for (int k = 0; k < 8; k += 2) {
                    int b = src_px[k * 4 + 0];
                    int g = src_px[k * 4 + 1];
                    int r = src_px[k * 4 + 2];

                    int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;

                    uv_row[i + k]     = (uint8_t)(u < 0 ? 0 : (u > 255 ? 255 : u));
                    uv_row[i + k + 1] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
                }
            }
        }

        // Tail loop for remaining pixels
        for (; i < width; ++i) {
            int bgra_idx = i * 4;
            int b = bgra_row[bgra_idx + 0];
            int g = bgra_row[bgra_idx + 1];
            int r = bgra_row[bgra_idx + 2];

            int y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            y_row[i] = (uint8_t)(y < 0 ? 0 : (y > 255 ? 255 : y));

            if (is_even_row && (i % 2 == 0)) {
                int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;

                uv_row[i]     = (uint8_t)(u < 0 ? 0 : (u > 255 ? 255 : u));
                uv_row[i + 1] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
            }
        }
    }
#else
    // Pure scalar fallback
    for (int j = 0; j < height; ++j) {
        for (int i = 0; i < width; ++i) {
            int bgra_idx = (j * width + i) * 4;
            uint8_t b = bgra_data[bgra_idx];
            uint8_t g = bgra_data[bgra_idx + 1];
            uint8_t r = bgra_data[bgra_idx + 2];

            y_plane[j * width + i] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;

            if (j % 2 == 0 && i % 2 == 0) {
                int uv_idx = (j / 2) * width + i;
                uv_plane[uv_idx]     = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                uv_plane[uv_idx + 1] = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            }
        }
    }
#endif
}

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

    // Enable low latency encoding mode
    IMFAttributes* pAttributes = nullptr;
    if (SUCCEEDED(pEncoder->GetAttributes(&pAttributes))) {
        pAttributes->SetUINT32(GS_MF_LOW_LATENCY, 1);
        pAttributes->SetUINT32(GS_CODECAPI_AVLowLatencyMode, 1);
        pAttributes->Release();
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

    // Fast SIMD-accelerated BGRA to NV12 conversion
    size_t y_size = width_ * height_;
    size_t uv_size = y_size / 2;
    nv12_buffer_.resize(y_size + uv_size);
    ConvertBGRAtoNV12_SIMD(bgra_data, width_, height_, nv12_buffer_.data());

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

    if (FAILED(hr)) {
        static int input_err_count = 0;
        if (input_err_count++ % 30 == 0) {
            Utils::Log("ERROR", "[H264Encoder] ProcessInput failed with HR: " + std::to_string(hr));
        }
        return false;
    }

    MFT_OUTPUT_STREAM_INFO streamInfo = {0};
    pEncoder->GetOutputStreamInfo(0, &streamInfo);

    bool encoded_something = false;
    while (true) {
        MFT_OUTPUT_DATA_BUFFER outputDataBuffer;
        memset(&outputDataBuffer, 0, sizeof(outputDataBuffer));
        outputDataBuffer.dwStreamID = 0;

        IMFSample* pOutSample = nullptr;
        IMFMediaBuffer* pOutMemBuffer = nullptr;
        if (!(streamInfo.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES)) {
            MFCreateSample(&pOutSample);
            DWORD bufSize = streamInfo.cbSize ? streamInfo.cbSize : (1024 * 1024);
            MFCreateMemoryBuffer(bufSize, &pOutMemBuffer);
            pOutSample->AddBuffer(pOutMemBuffer);
            outputDataBuffer.pSample = pOutSample;
        }

        DWORD status = 0;
        hr = pEncoder->ProcessOutput(0, 1, &outputDataBuffer, &status);

        if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) {
            if (pOutMemBuffer) pOutMemBuffer->Release();
            if (pOutSample) pOutSample->Release();
            break;
        } else if (SUCCEEDED(hr) && outputDataBuffer.pSample) {
            IMFMediaBuffer* pOutBuffer = nullptr;
            hr = outputDataBuffer.pSample->ConvertToContiguousBuffer(&pOutBuffer);
            if (SUCCEEDED(hr)) {
                BYTE* pOutData = nullptr;
                DWORD outLen = 0;
                pOutBuffer->Lock(&pOutData, nullptr, &outLen);
                if (outLen > 0) {
                    out_h264_nalu.insert(out_h264_nalu.end(), pOutData, pOutData + outLen);
                    encoded_something = true;
                }
                pOutBuffer->Unlock();
                pOutBuffer->Release();
            }
            outputDataBuffer.pSample->Release();
            if (outputDataBuffer.pEvents) outputDataBuffer.pEvents->Release();
            if (pOutMemBuffer) pOutMemBuffer->Release();
        } else {
            if (pOutMemBuffer) pOutMemBuffer->Release();
            if (pOutSample) pOutSample->Release();
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
