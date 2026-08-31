#include "../include/http_server.h"
#include "../include/encoder.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <sstream>
#include <vector>
#include <cstring>
#include <cerrno>
#include <exception>
#include <utility>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

namespace GridSight {

HttpServer::HttpServer(std::shared_ptr<ScreenCapturer> capturer)
    : capturer_(capturer) {}

HttpServer::~HttpServer() {
    Stop();
}

bool HttpServer::Start() {
    if (running_.exchange(true)) return true;

    try {
        snapshot_thread_ = std::thread(&HttpServer::SnapshotWorkerLoop, this);
    } catch (const std::exception& err) {
        running_ = false;
        Utils::Log("ERROR", "HttpServer snapshot worker startup failed: " + std::string(err.what()));
        return false;
    }

    Utils::Log("INFO", "HttpServer outbound snapshot push worker started (1 FPS Snapshot Engine Enabled)");
    return true;
}

void HttpServer::Stop() {
    if (!running_.exchange(false)) return;

    if (snapshot_thread_.joinable()) {
        snapshot_thread_.join();
    }
}

void HttpServer::SetTeacherHost(const std::string& host, int port) {
    std::lock_guard<std::mutex> lock(teacher_mutex_);
    teacher_host_ = host;
    teacher_port_ = port;
    Utils::Log("INFO", "HttpServer updated teacher destination for outbound push: " + host + ":" + std::to_string(port));
}

void HttpServer::PushSnapshotToTeacher(const std::vector<uint8_t>& jpeg_data) {
    std::string host;
    int port = 3000;
    {
        std::lock_guard<std::mutex> lock(teacher_mutex_);
        host = teacher_host_;
        port = teacher_port_;
    }
    if (host.empty()) return;

    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) return;

#ifdef _WIN32
    DWORD timeout = 2000;
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    struct timeval timeout = { 2, 0 };
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
#endif

    sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

    if (connect(s, (sockaddr*)&addr, sizeof(addr)) != SOCKET_ERROR) {
        NetworkInfo net = Utils::GetSystemNetworkInfo();
        const std::string session_token = TokenManager::Instance().GetSessionToken();
        std::string win_title = Utils::GetActiveWindowTitle();
        std::string win_b64 = Utils::Base64Encode((const uint8_t*)win_title.data(), win_title.size());
        std::ostringstream oss;
        oss << "POST /api/agent/snapshot HTTP/1.1\r\n"
            << "Host: " << host << ":" << port << "\r\n"
            << "X-Agent-MAC: " << net.mac << "\r\n"
            << "X-Agent-IP: " << net.ip << "\r\n"
            << "X-Auth-Token: " << session_token << "\r\n"
            << "X-Active-Window: " << win_b64 << "\r\n"
            << "Content-Type: image/jpeg\r\n"
            << "Content-Length: " << jpeg_data.size() << "\r\n"
            << "Connection: close\r\n\r\n";
        std::string header = oss.str();
        send(s, header.c_str(), (int)header.length(), 0);
        send(s, (const char*)jpeg_data.data(), (int)jpeg_data.size(), 0);

        char buf[256] = {0};
        const int received = recv(s, buf, sizeof(buf) - 1, 0);
        if (received > 0) {
            const std::string response(buf, received);
            if (response.find(" 200 ") != std::string::npos) {
                Utils::UpdateHeartbeat("snapshot-push");
            }
        }
    }
    closesocket(s);
}

void HttpServer::SnapshotWorkerLoop() {
    // Background snapshot engine: captures, compresses, and pushes screen at 1 FPS
    while (running_) {
        Utils::UpdateHeartbeat("capture-worker");
        FrameData frame;
        if (capturer_->CaptureFrame(frame)) {
            Utils::UpdateHeartbeat("capture-success");
            std::vector<uint8_t> jpeg_data;
            if (ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 480, 270, 70, jpeg_data)) {
                Utils::UpdateHeartbeat("snapshot-encode");
                {
                    std::lock_guard<std::mutex> lock(snapshot_mutex_);
                    cached_jpeg_data_ = jpeg_data;
                    cached_jpeg_timestamp_ = Utils::GetCurrentTimestampMs();
                }
                PushSnapshotToTeacher(jpeg_data);
            }
        }
        Utils::SleepMs(1000); // 1 FPS polling cadence
    }
}

} // namespace GridSight
