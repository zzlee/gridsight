#pragma once
#include <atomic>
#include <thread>
#include <string>

namespace GridSight {

class RTPReceiver {
public:
    RTPReceiver(const std::string& multicast_ip = "239.255.42.100", int port = 9000);
    ~RTPReceiver();

    bool Start();
    void Stop();

private:
    void ReceiveLoop();
    void CreateFullScreenOverlayWindow();
    void RenderFrame(const uint8_t* h264_data, size_t size);
    void CloseOverlayWindow();

    std::string multicast_ip_;
    int port_;
    std::atomic<bool> running_{false};
    std::atomic<bool> overlay_active_{false};
    std::thread receive_thread_;
    void* hwnd_overlay_ = nullptr;
};

} // namespace GridSight
