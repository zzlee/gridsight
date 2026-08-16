#pragma once
#include "capture.h"
#include "encoder.h"
#include <atomic>
#include <thread>
#include <memory>
#include <mutex>
#include <vector>

namespace GridSight {

class WebSocketStreamer {
public:
    WebSocketStreamer(int port, std::shared_ptr<ScreenCapturer> capturer);
    ~WebSocketStreamer();

    bool Start();
    void Stop();

private:
    void AcceptLoop();
    void StreamLoop();

    int port_;
    std::shared_ptr<ScreenCapturer> capturer_;
    std::unique_ptr<H264Encoder> encoder_;
    std::atomic<bool> running_{false};
    std::atomic<bool> client_connected_{false};
    std::thread accept_thread_;
    std::thread stream_thread_;
    uintptr_t listen_fd_ = 0;
    uintptr_t active_client_fd_ = 0;
    std::mutex client_mutex_;
};

} // namespace GridSight
