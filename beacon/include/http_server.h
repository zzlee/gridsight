#pragma once
#include "capture.h"
#include <atomic>
#include <thread>
#include <memory>
#include <mutex>
#include <vector>
#include <string>

namespace GridSight {

class HttpServer {
public:
    HttpServer(int port, std::shared_ptr<ScreenCapturer> capturer);
    ~HttpServer();

    bool Start();
    void Stop();
    void SetTeacherHost(const std::string& host, int port = 3000);

private:
    void ListenLoop();
    void SnapshotWorkerLoop();
    void PushSnapshotToTeacher(const std::vector<uint8_t>& jpeg_data);
    void HandleClient(uintptr_t client_socket);
    bool AuthenticateRequest(std::istringstream& stream);
    void HandleSnapshotRequest(uintptr_t client_socket, const std::string& path);
    void HandleStatusRequest(uintptr_t client_socket);
    void HandlePingRequest(uintptr_t client_socket);
    void HandleLogsRequest(uintptr_t client_socket);
    void SendResponse(uintptr_t client_socket, int status_code, 
                      const std::string& content_type, const std::vector<uint8_t>& body);

    int port_;
    std::shared_ptr<ScreenCapturer> capturer_;
    std::atomic<bool> running_{false};
    std::thread server_thread_;
    std::thread snapshot_thread_;
    uintptr_t listen_fd_ = 0;

    // Snapshot background cache
    std::mutex snapshot_mutex_;
    std::vector<uint8_t> cached_jpeg_data_;
    uint64_t cached_jpeg_timestamp_ = 0;

    // Teacher console destination for outbound push
    std::mutex teacher_mutex_;
    std::string teacher_host_;
    int teacher_port_ = 3000;
};

} // namespace GridSight
