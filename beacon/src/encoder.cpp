#include "../include/encoder.h"
#include "../include/utils.h"
#include <iostream>
#include <algorithm>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wmcodecdsp.h>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "wmcodecdspuuid.lib")
#pragma comment(lib, "ole32.lib")
#endif

namespace GridSight {

// Fast, integer-based BGRA to NV12 conversion
static void ConvertBGRAToNV12(const uint8_t* bgra, int width, int height, std::vector<uint8_t>& nv12) {
    size_t y_size = width * height;
    size_t uv_size = y_size / 2;
    nv12.resize(y_size + uv_size);
    uint8_t* y_plane = nv12.data();
    uint8_t* uv_plane = nv12.data() + y_size;

    for (int j = 0; j < height; ++j) {
        for (int i = 0; i < width; ++i) {
            int bgra_idx = (j * width + i) * 4;
            uint8_t b = bgra[bgra_idx];
            uint8_t g = bgra[bgra_idx + 1];
            uint8_t r = bgra[bgra_idx + 2];

            y_plane[j * width + i] = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;

            if (j % 2 == 0 && i % 2 == 0) {
                int uv_idx = (j / 2) * width + i;
                uv_plane[uv_idx] = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                uv_plane[uv_idx + 1] = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            }
        }
    }
}

// Fast bilinear image downscaler helper
static void DownscaleBGRA(const uint8_t* src, int src_w, int src_h,
                          uint8_t* dst, int dst_w, int dst_h) {
    float x_ratio = (float)src_w / dst_w;
    float y_ratio = (float)src_h / dst_h;
    for (int y = 0; y < dst_h; ++y) {
        int src_y = std::min((int)(y * y_ratio), src_h - 1);
        for (int x = 0; x < dst_w; ++x) {
            int src_x = std::min((int)(x * x_ratio), src_w - 1);
            int src_idx = (src_y * src_w + src_x) * 4;
            int dst_idx = (y * dst_w + x) * 4;
            dst[dst_idx + 0] = src[src_idx + 0]; // B
            dst[dst_idx + 1] = src[src_idx + 1]; // G
            dst[dst_idx + 2] = src[src_idx + 2]; // R
            dst[dst_idx + 3] = 255;              // A
        }
    }
}

bool ImageEncoder::EncodeToJPEG(const uint8_t* bgra_data, int width, int height, 
                                int target_width, int target_height, int quality, 
                                std::vector<uint8_t>& out_jpeg) {
    if (!bgra_data || width <= 0 || height <= 0 || target_width <= 0 || target_height <= 0) {
        return false;
    }

    std::vector<uint8_t> downscaled(target_width * target_height * 4);
    DownscaleBGRA(bgra_data, width, height, downscaled.data(), target_width, target_height);

    // Minimal PPM / JPEG mock wrapper for compilation across platforms
    // In production with libjpeg-turbo or stb_image_write, compress downscaled BGRA/RGB
    out_jpeg.clear();
    // JPEG SOI marker
    out_jpeg.push_back(0xFF);
    out_jpeg.push_back(0xD8);
    // Simple placeholder payload for mock/build, real implementation links libjpeg-turbo
    out_jpeg.insert(out_jpeg.end(), downscaled.begin(), downscaled.begin() + std::min((size_t)4096, downscaled.size()));
    // JPEG EOI marker
    out_jpeg.push_back(0xFF);
    out_jpeg.push_back(0xD9);
    return true;
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

    // 1. Try Hardware Encoder first
    hr = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, nullptr, &info, &ppActivate, &count);
    if (SUCCEEDED(hr) && count > 0) {
        hr = ppActivate[0]->ActivateObject(IID_PPV_ARGS(&pEncoder));
        for (UINT32 i = 0; i < count; i++) ppActivate[i]->Release();
        CoTaskMemFree(ppActivate);
        Utils::Log("INFO", "Initialized hardware H264 encoder.");
    }

    // 2. Fallback to Software Encoder
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

    // Set output type (H.264)
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

    // Set input type (NV12)
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

    ConvertBGRAToNV12(bgra_data, width_, height_, nv12_buffer_);

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

    // Optional: attempting to signal clean point, but true IDR force on MF requires ICodecAPI
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
                // Append the NALU to support multiple outputs per input if needed
                out_h264_nalu.insert(out_h264_nalu.end(), pOutData, pOutData + outLen);
                pOutBuffer->Unlock();
                pOutBuffer->Release();
                encoded_something = true;
            }
            outputDataBuffer.pSample->Release();
            if (outputDataBuffer.pEvents) outputDataBuffer.pEvents->Release();
        } else {
            break; // Other error
        }
    }

    return encoded_something || out_h264_nalu.empty();
#else
    // Simulation of H.264 NAL units (SPS/PPS + IDR or P slice) for non-Windows mock compilation
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
