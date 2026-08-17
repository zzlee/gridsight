#include "../include/http_server.h"
#include "../include/encoder.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <sstream>
#include <vector>
#include <cstring>

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

HttpServer::HttpServer(int port, std::shared_ptr<ScreenCapturer> capturer)
    : port_(port), capturer_(capturer) {}

HttpServer::~HttpServer() {
    Stop();
}

bool HttpServer::Start() {
    if (running_.exchange(true)) return true;
    snapshot_thread_ = std::thread(&HttpServer::SnapshotWorkerLoop, this);
    server_thread_ = std::thread(&HttpServer::ListenLoop, this);
    Utils::Log("INFO", "HttpServer listening on port " + std::to_string(port_) + " (Asynchronous 1 FPS Snapshot Cache Enabled)");
    return true;
}

void HttpServer::Stop() {
    if (!running_.exchange(false)) return;
    if (listen_fd_ != 0 && (SOCKET)listen_fd_ != INVALID_SOCKET) {
        closesocket((SOCKET)listen_fd_);
        listen_fd_ = 0;
    }
    if (snapshot_thread_.joinable()) {
        snapshot_thread_.join();
    }
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
}

void HttpServer::SnapshotWorkerLoop() {
    // Background snapshot engine: captures and compresses screen at 1 FPS
    // Decouples DXGI capture and JPEG encoding from incoming HTTP socket requests
    while (running_) {
        FrameData frame;
        if (capturer_->CaptureFrame(frame)) {
            std::vector<uint8_t> jpeg_data;
            if (ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 480, 270, 70, jpeg_data)) {
                std::lock_guard<std::mutex> lock(snapshot_mutex_);
                cached_jpeg_data_ = std::move(jpeg_data);
                cached_jpeg_timestamp_ = Utils::GetCurrentTimestampMs();
            }
        }
        Utils::SleepMs(1000); // 1 FPS polling cadence
    }
}

void HttpServer::ListenLoop() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    SOCKET server_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (server_sock == INVALID_SOCKET) return;
    listen_fd_ = (uintptr_t)server_sock;

    int opt = 1;
#ifdef _WIN32
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
#else
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

    sockaddr_in server_addr = {0};
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(port_);

    if (bind(server_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        Utils::Log("ERROR", "HttpServer bind failed on port " + std::to_string(port_));
        closesocket(server_sock);
        return;
    }

    if (listen(server_sock, 16) == SOCKET_ERROR) {
        closesocket(server_sock);
        return;
    }

    while (running_) {
        sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        SOCKET client_sock = accept(server_sock, (sockaddr*)&client_addr, &client_len);
        if (client_sock == INVALID_SOCKET) {
            if (!running_) break;
            Utils::SleepMs(50);
            continue;
        }

        std::thread([this, client_sock]() {
            HandleClient((uintptr_t)client_sock);
        }).detach();
    }
}

void HttpServer::HandleClient(uintptr_t client_socket) {
    SOCKET s = (SOCKET)client_socket;

    // Set send and receive timeouts to 3000ms
#ifdef _WIN32
    DWORD timeout = 3000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    struct timeval timeout;
    timeout.tv_sec = 3;
    timeout.tv_usec = 0;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
#endif

    char buffer[2048] = {0};
    int bytes = recv(s, buffer, sizeof(buffer) - 1, 0);
    if (bytes <= 0) {
        closesocket(s);
        return;
    }

    std::string req(buffer, bytes);
    std::istringstream stream(req);
    std::string method, path, proto;
    stream >> method >> path >> proto;

    // Handle HTTP OPTIONS CORS preflight
    if (method == "OPTIONS") {
        SendResponse(client_socket, 200, "text/plain", {});
        closesocket(s);
        return;
    }

    // Check token authentication header if token set
    std::string token_header;
    std::string line;
    while (std::getline(stream, line) && line != "\r" && line != "") {
        if (line.find("X-Auth-Token:") == 0 || line.find("x-auth-token:") == 0) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                token_header = line.substr(colon + 1);
                while (!token_header.empty() && (token_header.front() == ' ' || token_header.front() == '\t'))
                    token_header.erase(0, 1);
                while (!token_header.empty() && (token_header.back() == '\r' || token_header.back() == '\n' || token_header.back() == ' '))
                    token_header.pop_back();
            }
        }
    }

    if (TokenManager::Instance().HasValidToken()) {
        if (!TokenManager::Instance().ValidateToken(token_header)) {
            std::string err = "{\"error\":\"Unauthorized: Invalid X-Auth-Token\"}";
            SendResponse(client_socket, 401, "application/json", std::vector<uint8_t>(err.begin(), err.end()));
            closesocket(s);
            return;
        }
    }

    if (path.find("/snapshot") == 0) {
        std::vector<uint8_t> jpeg_to_send;
        {
            std::lock_guard<std::mutex> lock(snapshot_mutex_);
            jpeg_to_send = cached_jpeg_data_;
        }

        if (!jpeg_to_send.empty()) {
            // Immediate return from background snapshot cache (< 0.2ms latency!)
            SendResponse(client_socket, 200, "image/jpeg", jpeg_to_send);
        } else {
            // Cold start fallback
            FrameData frame;
            if (capturer_->CaptureFrame(frame)) {
                std::vector<uint8_t> jpeg_data;
                ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 480, 270, 70, jpeg_data);
                SendResponse(client_socket, 200, "image/jpeg", jpeg_data);
            } else {
                std::string err = "{\"error\":\"Capture failed\"}";
                SendResponse(client_socket, 500, "application/json", std::vector<uint8_t>(err.begin(), err.end()));
            }
        }
    } else if (path == "/status" || path == "/api/status") {
        SystemHardwareInfo hw = Utils::GetSystemHardwareInfo();
        std::ostringstream json;
        json << "{"
             << "\"status\":\"ok\","
             << "\"service\":\"GridSight Beacon\","
             << "\"hostname\":\"" << hw.hostname << "\","
             << "\"os\":\"" << hw.os_name << "\","
             << "\"uptime\":" << hw.uptime_seconds << ","
             << "\"cpu\":{"
             <<   "\"model\":\"" << hw.cpu_model << "\","
             <<   "\"cores\":" << hw.cpu_cores << ","
             <<   "\"usage_percent\":" << hw.cpu_usage_percent
             << "},"
             << "\"ram\":{"
             <<   "\"total_mb\":" << hw.ram_total_mb << ","
             <<   "\"avail_mb\":" << hw.ram_avail_mb << ","
             <<   "\"usage_percent\":" << hw.ram_usage_percent
             << "},"
             << "\"disk\":{"
             <<   "\"drive\":\"" << hw.disk_drive << "\","
             <<   "\"total_gb\":" << hw.disk_total_gb << ","
             <<   "\"free_gb\":" << hw.disk_free_gb << ","
             <<   "\"usage_percent\":" << hw.disk_usage_percent
             << "}"
             << "}";
        std::string json_str = json.str();
        SendResponse(client_socket, 200, "application/json", std::vector<uint8_t>(json_str.begin(), json_str.end()));
    } else if (path == "/ping") {
        std::string json = "{\"status\":\"ok\",\"service\":\"GridSight Beacon\"}";
        SendResponse(client_socket, 200, "application/json", std::vector<uint8_t>(json.begin(), json.end()));
    } else {
        std::string not_found = "{\"error\":\"Not found\"}";
        SendResponse(client_socket, 404, "application/json", std::vector<uint8_t>(not_found.begin(), not_found.end()));
    }

    closesocket(s);
}

void HttpServer::SendResponse(uintptr_t client_socket, int status_code, 
                             const std::string& content_type, const std::vector<uint8_t>& body) {
    SOCKET s = (SOCKET)client_socket;
    std::string status_msg = (status_code == 200) ? "200 OK" : (status_code == 401 ? "401 Unauthorized" : "404 Not Found");
    std::ostringstream oss;
    oss << "HTTP/1.1 " << status_msg << "\r\n"
        << "Access-Control-Allow-Origin: *\r\n"
        << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        << "Access-Control-Allow-Headers: X-Auth-Token, Content-Type\r\n"
        << "Access-Control-Max-Age: 86400\r\n"
        << "Cache-Control: no-cache, no-store, must-revalidate\r\n"
        << "Content-Type: " << content_type << "\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Connection: close\r\n\r\n";
    
    std::string header = oss.str();
    send(s, header.c_str(), (int)header.length(), 0);
    if (!body.empty()) {
        send(s, (const char*)body.data(), (int)body.size(), 0);
    }
}

} // namespace GridSight
