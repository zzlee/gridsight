#include "../include/ws_server.h"
#include "../include/utils.h"
#include <iostream>
#include <sstream>
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

static void SendAll(SOCKET sock, const uint8_t* data, size_t len) {
    size_t total_sent = 0;
    while (total_sent < len) {
        int sent = send(sock, (const char*)data + total_sent, (int)(len - total_sent), 0);
        if (sent <= 0) break;
        total_sent += sent;
    }
}

WebSocketStreamer::WebSocketStreamer(int port, std::shared_ptr<ScreenCapturer> capturer)
    : port_(port), capturer_(capturer), encoder_(std::make_unique<H264Encoder>()) {}

WebSocketStreamer::~WebSocketStreamer() {
    Stop();
}

bool WebSocketStreamer::Start() {
    if (running_.exchange(true)) return true;
    encoder_->Initialize(1280, 720, 30, 2500);
    accept_thread_ = std::thread(&WebSocketStreamer::AcceptLoop, this);
    stream_thread_ = std::thread(&WebSocketStreamer::StreamLoop, this);
    Utils::Log("INFO", "WebSocketStreamer started on port " + std::to_string(port_));
    return true;
}

void WebSocketStreamer::Stop() {
    if (!running_.exchange(false)) return;

    if (listen_fd_ != 0 && (SOCKET)listen_fd_ != INVALID_SOCKET) {
        closesocket((SOCKET)listen_fd_);
        listen_fd_ = 0;
    }

    {
        std::lock_guard<std::mutex> lock(client_mutex_);
        if (active_client_fd_ != 0 && (SOCKET)active_client_fd_ != INVALID_SOCKET) {
            closesocket((SOCKET)active_client_fd_);
            active_client_fd_ = 0;
        }
        client_connected_ = false;
    }

    if (accept_thread_.joinable()) accept_thread_.join();
    if (stream_thread_.joinable()) stream_thread_.join();
    encoder_->Release();
}

void WebSocketStreamer::AcceptLoop() {
    SOCKET server_fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (server_fd == INVALID_SOCKET) {
        Utils::Log("ERROR", "WebSocketStreamer failed to create socket");
        return;
    }

    int opt = 1;
#ifdef _WIN32
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
#else
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port_);

    if (bind(server_fd, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        Utils::Log("ERROR", "WebSocketStreamer bind error on port " + std::to_string(port_));
        closesocket(server_fd);
        return;
    }

    if (listen(server_fd, 5) == SOCKET_ERROR) {
        closesocket(server_fd);
        return;
    }

    listen_fd_ = (uintptr_t)server_fd;

    while (running_) {
        sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        SOCKET client_fd = accept(server_fd, (sockaddr*)&client_addr, &client_len);
        if (client_fd == INVALID_SOCKET) {
            if (!running_) break;
            Utils::SleepMs(100);
            continue;
        }

        // Read WebSocket HTTP Upgrade Request
        char buffer[2048] = {0};
        int bytes = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
        if (bytes <= 0) {
            closesocket(client_fd);
            continue;
        }

        std::string req(buffer, bytes);
        size_t key_pos = req.find("Sec-WebSocket-Key:");
        if (key_pos == std::string::npos) {
            // Not a valid WebSocket handshake
            closesocket(client_fd);
            continue;
        }

        key_pos += 18;
        while (key_pos < req.size() && (req[key_pos] == ' ' || req[key_pos] == '\t')) key_pos++;
        size_t end_pos = req.find("\r\n", key_pos);
        if (end_pos == std::string::npos) end_pos = req.find('\n', key_pos);
        if (end_pos == std::string::npos) {
            closesocket(client_fd);
            continue;
        }

        std::string client_key = req.substr(key_pos, end_pos - key_pos);
        std::string accept_key = Utils::ComputeWebSocketAcceptKey(client_key);

        std::string response = 
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: " + accept_key + "\r\n"
            "\r\n";

        send(client_fd, response.c_str(), (int)response.length(), 0);

        {
            std::lock_guard<std::mutex> lock(client_mutex_);
            if (active_client_fd_ != 0 && (SOCKET)active_client_fd_ != INVALID_SOCKET) {
                closesocket((SOCKET)active_client_fd_);
            }
            active_client_fd_ = (uintptr_t)client_fd;
            client_connected_ = true;
        }
        Utils::Log("INFO", "WebSocket client connected for 30FPS stream");
    }
}

void WebSocketStreamer::StreamLoop() {
    bool force_idr = true;
    int frame_count = 0;

    while (running_) {
        if (client_connected_) {
            FrameData frame;
            if (capturer_->CaptureFrame(frame)) {
                std::vector<uint8_t> nalu;
                // Force keyframe every 30 frames (~1 sec GOP) or on connect
                bool is_keyframe = force_idr || (frame_count % 30 == 0);
                if (encoder_->EncodeFrame(frame.bgra_buffer.data(), is_keyframe, nalu) && !nalu.empty()) {
                    force_idr = false;
                    frame_count++;

                    // Package NALU into RFC 6455 Binary Frame (Opcode 0x02)
                    std::vector<uint8_t> ws_frame;
                    ws_frame.push_back(0x82); // FIN = 1, Opcode = 2 (Binary)

                    size_t payload_len = nalu.size();
                    if (payload_len < 126) {
                        ws_frame.push_back((uint8_t)payload_len);
                    } else if (payload_len <= 65535) {
                        ws_frame.push_back(126);
                        ws_frame.push_back((uint8_t)((payload_len >> 8) & 0xFF));
                        ws_frame.push_back((uint8_t)(payload_len & 0xFF));
                    } else {
                        ws_frame.push_back(127);
                        for (int i = 7; i >= 0; i--) {
                            ws_frame.push_back((uint8_t)((payload_len >> (i * 8)) & 0xFF));
                        }
                    }

                    ws_frame.insert(ws_frame.end(), nalu.begin(), nalu.end());

                    std::lock_guard<std::mutex> lock(client_mutex_);
                    if (active_client_fd_ != 0 && (SOCKET)active_client_fd_ != INVALID_SOCKET) {
                        SOCKET client_sock = (SOCKET)active_client_fd_;
                        int sent = send(client_sock, (const char*)ws_frame.data(), (int)ws_frame.size(), 0);
                        if (sent <= 0) {
                            Utils::Log("WARN", "WebSocket client disconnected during streaming");
                            closesocket(client_sock);
                            active_client_fd_ = 0;
                            client_connected_ = false;
                            force_idr = true;
                        }
                    }
                }
            }
        }
        Utils::SleepMs(33); // ~30 FPS
    }
}

} // namespace GridSight
