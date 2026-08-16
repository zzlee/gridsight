#pragma once
#include <vector>
#include <cstdint>
#include <memory>
#include <mutex>

namespace GridSight {

struct FrameData {
    std::vector<uint8_t> bgra_buffer;
    int width = 0;
    int height = 0;
    int pitch = 0;
    uint64_t timestamp_ms = 0;
};

class ScreenCapturer {
public:
    ScreenCapturer();
    ~ScreenCapturer();

    bool Initialize();
    bool CaptureFrame(FrameData& out_frame);
    void Release();

    int GetScreenWidth() const { return screen_width_; }
    int GetScreenHeight() const { return screen_height_; }

private:
    bool ReacquireDuplication();

    int screen_width_ = 0;
    int screen_height_ = 0;
    bool initialized_ = false;
    std::mutex capture_mutex_;
    void* dxgi_device_ = nullptr;
    void* dxgi_dup_ = nullptr;
};

} // namespace GridSight
