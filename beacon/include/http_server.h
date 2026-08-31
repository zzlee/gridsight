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
    explicit HttpServer(std::shared_ptr<ScreenCapturer> capturer);
    ~HttpServer();

    bool Start();
    void Stop();
    void SetTeacherHost(const std::string& host, int port = 3000);

private:
    void SnapshotWorkerLoop();
    void PushSnapshotToTeacher(const std::vector<uint8_t>& jpeg_data);

    std::shared_ptr<ScreenCapturer> capturer_;
    std::atomic<bool> running_{false};
    std::thread snapshot_thread_;

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
