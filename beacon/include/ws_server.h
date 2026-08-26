#pragma once
#include "capture.h"
#include "encoder.h"
#include <atomic>
#include <thread>
#include <memory>
#include <mutex>
#include <vector>
#include <string>

namespace GridSight {

class WebSocketStreamer {
public:
    WebSocketStreamer(int port, std::shared_ptr<ScreenCapturer> capturer);
    ~WebSocketStreamer();

    bool Start();
    void Stop();
    void SetTeacherHost(const std::string& host, int port = 3000);

private:
    void AcceptLoop();
    void ConnectOutboundLoop();
    void StreamLoop();
    void ReceiveCommands(uintptr_t sock_fd);
    void HandleCommandMessage(uintptr_t sock_fd, const std::string& message);
    bool SendWsClientFrame(uintptr_t sock_fd, uint8_t opcode, const uint8_t* data, size_t len);
    void SendWsClientBinary(uintptr_t sock_fd, const uint8_t* data, size_t len);
    void SendWsClientText(uintptr_t sock_fd, const std::string& text);

    int port_;
    std::shared_ptr<ScreenCapturer> capturer_;
    std::unique_ptr<H264Encoder> encoder_;
    std::atomic<bool> running_{false};
    std::atomic<bool> client_connected_{false};
    std::atomic<bool> streaming_active_{false};

    std::thread accept_thread_;
    std::thread outbound_thread_;
    std::thread stream_thread_;

    std::atomic<uintptr_t> listen_fd_{0};
    uintptr_t active_client_fd_ = 0;
    uintptr_t outbound_sock_ = 0;
    std::mutex client_mutex_;
    std::mutex send_mutex_;
    std::mutex teacher_mutex_;

    std::string teacher_host_;
    int teacher_port_ = 3000;
};

} // namespace GridSight
