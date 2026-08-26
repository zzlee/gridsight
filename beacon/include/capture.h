#pragma once
#include <vector>
#include <cstdint>
#include <memory>
#include <mutex>

namespace GridSight {

struct CaptureStatus {
    bool initialized = false;
    bool frame_ready = false;
    uint64_t last_success_timestamp_ms = 0;
};

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
    CaptureStatus GetStatus() const;

    int GetScreenWidth() const { return screen_width_; }
    int GetScreenHeight() const { return screen_height_; }

private:
    // Callers must hold capture_mutex_. Keeping the resource lifecycle in
    // locked helpers prevents CaptureFrame from recursively locking itself
    // when initialization or DXGI reacquisition is required.
    bool InitializeLocked();
    bool ReacquireDuplicationLocked();
    void ReleaseLocked();

    int screen_width_ = 0;
    int screen_height_ = 0;
    bool initialized_ = false;
    bool frame_ready_ = false;
    uint64_t last_success_timestamp_ms_ = 0;
    mutable std::mutex capture_mutex_;
    void* dxgi_device_ = nullptr;
    void* d3d_context_ = nullptr;
    void* dxgi_dup_ = nullptr;
    void* staging_tex_ = nullptr;
};

} // namespace GridSight
