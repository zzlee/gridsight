#pragma once
#include "capture.h"
#include <vector>
#include <cstdint>

namespace GridSight {

enum class JpegEngineType {
    AUTO = 0,
    WINDOWS_WIC,
    TURBO_SIMD_FALLBACK
};

class ImageEncoder {
public:
    static bool EncodeToJPEG(const uint8_t* bgra_data, int width, int height, 
                             int target_width, int target_height, int quality, 
                             std::vector<uint8_t>& out_jpeg);

    static bool EncodeToWebP(const uint8_t* bgra_data, int width, int height, 
                             int target_width, int target_height, float quality, 
                             std::vector<uint8_t>& out_webp);

    static const char* GetActiveJpegEngineName();

private:
    static bool EncodeWithWIC(const uint8_t* bgra_data, int width, int height,
                              int target_width, int target_height, int quality,
                              std::vector<uint8_t>& out_jpeg);

    static bool EncodeWithTurbo(const uint8_t* bgra_data, int width, int height,
                                int target_width, int target_height, int quality,
                                std::vector<uint8_t>& out_jpeg);
};

class H264Encoder {
public:
    H264Encoder();
    ~H264Encoder();

    bool Initialize(int width, int height, int fps, int bitrate_kbps);
    bool EncodeFrame(const uint8_t* bgra_data, bool force_idr, std::vector<uint8_t>& out_h264_nalu);
    void Release();

private:
    int width_ = 0;
    int height_ = 0;
    int fps_ = 30;
    int bitrate_kbps_ = 3000;
    bool initialized_ = false;

    void* pEncoder_ = nullptr;
    long long rtStart_ = 0;
    std::vector<uint8_t> nv12_buffer_;
};

} // namespace GridSight
