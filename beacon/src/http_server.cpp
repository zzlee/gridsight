#include "../include/http_server.h"
#include "../include/encoder.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <fstream>
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
        std::string win_title = Utils::GetActiveWindowTitle();
        std::string win_b64 = Utils::Base64Encode((const uint8_t*)win_title.data(), win_title.size());
        std::ostringstream oss;
        oss << "POST /api/agent/snapshot HTTP/1.1\r\n"
            << "Host: " << host << ":" << port << "\r\n"
            << "X-Agent-MAC: " << net.mac << "\r\n"
            << "X-Agent-IP: " << net.ip << "\r\n"
            << "X-Active-Window: " << win_b64 << "\r\n"
            << "Content-Type: image/jpeg\r\n"
            << "Content-Length: " << jpeg_data.size() << "\r\n"
            << "Connection: close\r\n\r\n";
        std::string header = oss.str();
        send(s, header.c_str(), (int)header.length(), 0);
        send(s, (const char*)jpeg_data.data(), (int)jpeg_data.size(), 0);

        // Consume quick ACK response
        char buf[256];
        recv(s, buf, sizeof(buf) - 1, 0);
    }
    closesocket(s);
}

void HttpServer::SnapshotWorkerLoop() {
    // Background snapshot engine: captures, compresses, and pushes screen at 1 FPS
    while (running_) {
        FrameData frame;
        if (capturer_->CaptureFrame(frame)) {
            std::vector<uint8_t> jpeg_data;
            if (ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 480, 270, 70, jpeg_data)) {
                {
                    std::lock_guard<std::mutex> lock(snapshot_mutex_);
                    cached_jpeg_data_ = jpeg_data;
                    cached_jpeg_timestamp_ = Utils::GetCurrentTimestampMs();
                }
                // Outbound push to teacher console (initiated by student agent to avoid inbound firewall blocks)
                PushSnapshotToTeacher(jpeg_data);
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

bool HttpServer::AuthenticateRequest(std::istringstream& stream) {
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
        return TokenManager::Instance().ValidateToken(token_header);
    }
    return true;
}

void HttpServer::HandleSnapshotRequest(uintptr_t client_socket, const std::string& path) {
    std::vector<uint8_t> jpeg_to_send;

    // On-demand High-Res (1:1 Original Screen Resolution) for Focus Mode
    bool is_high_res = (path.find("full=1") != std::string::npos || path.find("highres=1") != std::string::npos);
    if (is_high_res) {
        FrameData frame;
        if (capturer_->CaptureFrame(frame)) {
            ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, frame.width, frame.height, 85, jpeg_to_send);
        }
    }

    if (jpeg_to_send.empty()) {
        std::lock_guard<std::mutex> lock(snapshot_mutex_);
        jpeg_to_send = cached_jpeg_data_;
    }

    if (!jpeg_to_send.empty()) {
        // Immediate return from snapshot cache or live high-res encoder
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
}

void HttpServer::HandleStatusRequest(uintptr_t client_socket) {
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
}

void HttpServer::HandlePingRequest(uintptr_t client_socket) {
    std::string json = "{\"status\":\"ok\",\"service\":\"GridSight Beacon\"}";
    SendResponse(client_socket, 200, "application/json", std::vector<uint8_t>(json.begin(), json.end()));
}

void HttpServer::HandleLogsRequest(uintptr_t client_socket) {
    std::string log_path = "gs-agent.log";
#ifdef _WIN32
    char temp_dir[MAX_PATH] = {0};
    if (GetTempPathA(MAX_PATH, temp_dir)) {
        log_path = std::string(temp_dir) + "gs-agent.log";
    }
#endif
    std::ifstream log_file(log_path, std::ios::binary);
    std::string content;
    if (log_file.is_open()) {
        log_file.seekg(0, std::ios::end);
        size_t size = log_file.tellg();
        size_t max_bytes = 256 * 1024;
        if (size > max_bytes) {
            log_file.seekg(size - max_bytes, std::ios::beg);
            content = "[... Log Truncated to Last 256KB ...]\n";
        } else {
            log_file.seekg(0, std::ios::beg);
        }
        std::string buffer(size > max_bytes ? max_bytes : size, '\0');
        log_file.read(&buffer[0], buffer.size());
        content += buffer;
        log_file.close();
    } else {
        content = "[GridSight Agent Log]\nNo log file (gs-agent.log) found or log is empty.\n";
    }

    SendResponse(client_socket, 200, "text/plain; charset=utf-8", std::vector<uint8_t>(content.begin(), content.end()));
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

    if (!AuthenticateRequest(stream)) {
        std::string err = "{\"error\":\"Unauthorized: Invalid X-Auth-Token\"}";
        SendResponse(client_socket, 401, "application/json", std::vector<uint8_t>(err.begin(), err.end()));
        closesocket(s);
        return;
    }

    if (path.find("/snapshot") == 0) {
        HandleSnapshotRequest(client_socket, path);
    } else if (path == "/status" || path == "/api/status") {
        HandleStatusRequest(client_socket);
    } else if (path == "/logs" || path == "/api/logs") {
        HandleLogsRequest(client_socket);
    } else if (path == "/ping") {
        HandlePingRequest(client_socket);
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
