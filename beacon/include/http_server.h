#pragma once
#include "capture.h"
#include <atomic>
#include <thread>
#include <memory>

namespace GridSight {

class HttpServer {
public:
    HttpServer(int port, std::shared_ptr<ScreenCapturer> capturer);
    ~HttpServer();

    bool Start();
    void Stop();

private:
    void ListenLoop();
    void HandleClient(uintptr_t client_socket);
    void SendResponse(uintptr_t client_socket, int status_code, 
                      const std::string& content_type, const std::vector<uint8_t>& body);

    int port_;
    std::shared_ptr<ScreenCapturer> capturer_;
    std::atomic<bool> running_{false};
    std::thread server_thread_;
    uintptr_t listen_fd_ = 0;
};

} // namespace GridSight
