#include "../include/http_server.h"
#include "../include/encoder.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <sstream>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
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
    server_thread_ = std::thread(&HttpServer::ListenLoop, this);
    Utils::Log("INFO", "HttpServer listening on port " + std::to_string(port_));
    return true;
}

void HttpServer::Stop() {
    if (!running_.exchange(false)) return;
#ifdef _WIN32
    if (listen_fd_) {
        closesocket((SOCKET)listen_fd_);
        listen_fd_ = 0;
    }
#endif
    if (server_thread_.joinable()) {
        server_thread_.join();
    }
}

void HttpServer::ListenLoop() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    SOCKET server_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (server_sock == INVALID_SOCKET) return;
    listen_fd_ = (uintptr_t)server_sock;

    int opt = 1;
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in server_addr = {0};
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(port_);

    if (bind(server_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        closesocket(server_sock);
        return;
    }

    listen(server_sock, 10);

    while (running_) {
        sockaddr_in client_addr;
        int client_len = sizeof(client_addr);
        SOCKET client_sock = accept(server_sock, (sockaddr*)&client_addr, &client_len);
        if (client_sock == INVALID_SOCKET) break;

        std::thread([this, client_sock]() {
            HandleClient((uintptr_t)client_sock);
        }).detach();
    }
#endif
}

void HttpServer::HandleClient(uintptr_t client_socket) {
#ifdef _WIN32
    SOCKET s = (SOCKET)client_socket;
    char buffer[4096] = {0};
    int bytes = recv(s, buffer, sizeof(buffer) - 1, 0);
    if (bytes <= 0) {
        closesocket(s);
        return;
    }

    std::string req(buffer, bytes);
    std::istringstream stream(req);
    std::string method, path, proto;
    stream >> method >> path >> proto;

    // Check token authentication header if token set
    std::string token_header;
    std::string line;
    while (std::getline(stream, line) && line != "") {
        if (line.find("X-Auth-Token:") == 0 || line.find("x-auth-token:") == 0) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                token_header = line.substr(colon + 1);
                while (!token_header.empty() && (token_header.front() == ' ' || token_header.front() == '	'))
                    token_header.erase(0, 1);
                while (!token_header.empty() && (token_header.back() == '' || token_header.back() == '
' || token_header.back() == ' '))
                    token_header.pop_back();
            }
        }
    }

    if (TokenManager::Instance().HasValidToken()) {
        if (!TokenManager::Instance().ValidateToken(token_header)) {
            std::string err = "{"error":"Unauthorized: Invalid X-Auth-Token"}";
            SendResponse(client_socket, 401, "application/json", std::vector<uint8_t>(err.begin(), err.end()));
            closesocket(s);
            return;
        }
    }

    if (path.find("/snapshot") == 0) {
        FrameData frame;
        if (capturer_->CaptureFrame(frame)) {
            std::vector<uint8_t> jpeg_data;
            ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 480, 270, 75, jpeg_data);
            SendResponse(client_socket, 200, "image/jpeg", jpeg_data);
        } else {
            std::string err = "{"error":"Capture failed"}";
            SendResponse(client_socket, 500, "application/json", std::vector<uint8_t>(err.begin(), err.end()));
        }
    } else if (path == "/ping" || path == "/status") {
        std::string json = "{"status":"ok","service":"GridSight Beacon"}";
        SendResponse(client_socket, 200, "application/json", std::vector<uint8_t>(json.begin(), json.end()));
    } else {
        std::string not_found = "{"error":"Not found"}";
        SendResponse(client_socket, 404, "application/json", std::vector<uint8_t>(not_found.begin(), not_found.end()));
    }

    closesocket(s);
#endif
}

void HttpServer::SendResponse(uintptr_t client_socket, int status_code, 
                             const std::string& content_type, const std::vector<uint8_t>& body) {
#ifdef _WIN32
    SOCKET s = (SOCKET)client_socket;
    std::string status_msg = (status_code == 200) ? "200 OK" : (status_code == 401 ? "401 Unauthorized" : "404 Not Found");
    std::ostringstream oss;
    oss << "HTTP/1.1 " << status_msg << "
"
        << "Access-Control-Allow-Origin: *
"
        << "Access-Control-Allow-Headers: X-Auth-Token, Content-Type
"
        << "Content-Type: " << content_type << "
"
        << "Content-Length: " << body.size() << "
"
        << "Connection: close

";
    
    std::string header = oss.str();
    send(s, header.c_str(), (int)header.length(), 0);
    if (!body.empty()) {
        send(s, (const char*)body.data(), (int)body.size(), 0);
    }
#endif
}

} // namespace GridSight
