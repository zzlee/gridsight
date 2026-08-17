#include "../include/ws_server.h"
#include "../include/utils.h"
#include "../include/token_manager.h"
#include <iostream>
#include <sstream>
#include <cstring>
#include <vector>

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

WebSocketStreamer::WebSocketStreamer(int port, std::shared_ptr<ScreenCapturer> capturer)
    : port_(port), capturer_(capturer), encoder_(std::make_unique<H264Encoder>()) {}

WebSocketStreamer::~WebSocketStreamer() {
    Stop();
}

void WebSocketStreamer::SetTeacherHost(const std::string& host, int port) {
    std::lock_guard<std::mutex> lock(teacher_mutex_);
    teacher_host_ = host;
    teacher_port_ = port;
    Utils::Log("INFO", "WebSocketStreamer teacher destination set to: " + host + ":" + std::to_string(port));
}

bool WebSocketStreamer::Start() {
    if (running_.exchange(true)) return true;
    encoder_->Initialize(1280, 720, 30, 2500);

    // 1. Inbound fallback listener
    accept_thread_ = std::thread(&WebSocketStreamer::AcceptLoop, this);
    // 2. Outbound persistent reverse connection to teacher
    outbound_thread_ = std::thread(&WebSocketStreamer::ConnectOutboundLoop, this);
    // 3. 30 FPS encoder and streamer loop
    stream_thread_ = std::thread(&WebSocketStreamer::StreamLoop, this);

    Utils::Log("INFO", "WebSocketStreamer started (Inbound port " + std::to_string(port_) + " + Outbound Reverse Streaming)");
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
        if (outbound_sock_ != 0 && (SOCKET)outbound_sock_ != INVALID_SOCKET) {
            closesocket((SOCKET)outbound_sock_);
            outbound_sock_ = 0;
        }
        client_connected_ = false;
        streaming_active_ = false;
    }

    if (accept_thread_.joinable()) accept_thread_.join();
    if (outbound_thread_.joinable()) outbound_thread_.join();
    if (stream_thread_.joinable()) stream_thread_.join();
    encoder_->Release();
}

void WebSocketStreamer::ConnectOutboundLoop() {
    while (running_) {
        std::string host;
        int port = 3000;
        {
            std::lock_guard<std::mutex> lock(teacher_mutex_);
            host = teacher_host_;
            port = teacher_port_;
        }

        if (host.empty()) {
            Utils::SleepMs(1000);
            continue;
        }

        SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
        if (s == INVALID_SOCKET) {
            Utils::SleepMs(2000);
            continue;
        }

        sockaddr_in addr = {0};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port);
        inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

        if (connect(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
            closesocket(s);
            Utils::SleepMs(2000);
            continue;
        }

        // Send WebSocket Client Upgrade Request (RFC 6455)
        NetworkInfo net = Utils::GetSystemNetworkInfo();
        std::string token = TokenManager::Instance().GetSessionToken();

        std::ostringstream oss;
        oss << "GET /ws/agent?mac=" << net.mac << "&ip=" << net.ip << "&token=" << token << " HTTP/1.1\r\n"
            << "Host: " << host << ":" << port << "\r\n"
            << "Upgrade: websocket\r\n"
            << "Connection: Upgrade\r\n"
            << "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            << "Sec-WebSocket-Version: 13\r\n\r\n";
        
        std::string req = oss.str();
        send(s, req.c_str(), (int)req.length(), 0);

        char buf[1024] = {0};
        int rec = recv(s, buf, sizeof(buf) - 1, 0);
        if (rec > 0 && std::string(buf).find("101 Switching Protocols") != std::string::npos) {
            Utils::Log("INFO", "✅ Reverse WebSocket Outbound Stream connected to Teacher " + host);
            {
                std::lock_guard<std::mutex> lock(client_mutex_);
                outbound_sock_ = (uintptr_t)s;
            }

            // Receive commands (START_STREAM / STOP_STREAM)
            ReceiveCommands((uintptr_t)s);

            {
                std::lock_guard<std::mutex> lock(client_mutex_);
                outbound_sock_ = 0;
                streaming_active_ = false;
            }
            Utils::Log("WARN", "Reverse WebSocket disconnected, retrying...");
        }

        closesocket(s);
        Utils::SleepMs(2000);
    }
}

void WebSocketStreamer::ReceiveCommands(uintptr_t sock_fd) {
    SOCKET sock = (SOCKET)sock_fd;
    char buffer[2048];

    while (running_) {
        int bytes = recv(sock, buffer, sizeof(buffer) - 1, 0);
        if (bytes <= 0) break;

        // Parse text or binary frame
        std::string msg(buffer, bytes);
        if (msg.find("START_STREAM") != std::string::npos) {
            Utils::Log("INFO", "🎯 [Stream Command] Received START_STREAM from Teacher Console, activating 30 FPS H.264 stream");
            streaming_active_ = true;
        } else if (msg.find("STOP_STREAM") != std::string::npos) {
            Utils::Log("INFO", "🛑 [Stream Command] Received STOP_STREAM from Teacher Console, pausing stream");
            streaming_active_ = false;
        }
    }
}

void WebSocketStreamer::SendWsClientBinary(uintptr_t sock_fd, const uint8_t* data, size_t len) {
    SOCKET sock = (SOCKET)sock_fd;
    if (sock == INVALID_SOCKET || len == 0) return;

    std::vector<uint8_t> frame;
    frame.push_back(0x82); // FIN + Binary frame

    uint8_t mask_key[4] = { 0x3E, 0x7B, 0x1A, 0x9F };

    if (len <= 125) {
        frame.push_back(0x80 | (uint8_t)len);
    } else if (len <= 65535) {
        frame.push_back(0x80 | 126);
        frame.push_back((uint8_t)((len >> 8) & 0xFF));
        frame.push_back((uint8_t)(len & 0xFF));
    } else {
        frame.push_back(0x80 | 127);
        for (int i = 7; i >= 0; --i) {
            frame.push_back((uint8_t)((len >> (i * 8)) & 0xFF));
        }
    }

    // Append 4-byte client mask
    for (int i = 0; i < 4; i++) frame.push_back(mask_key[i]);

    // Mask payload
    size_t header_size = frame.size();
    frame.resize(header_size + len);
    for (size_t i = 0; i < len; i++) {
        frame[header_size + i] = data[i] ^ mask_key[i % 4];
    }

    size_t total_sent = 0;
    while (total_sent < frame.size()) {
        int sent = send(sock, (const char*)frame.data() + total_sent, (int)(frame.size() - total_sent), 0);
        if (sent <= 0) break;
        total_sent += sent;
    }
}

void WebSocketStreamer::AcceptLoop() {
    SOCKET server_fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (server_fd == INVALID_SOCKET) return;

    int opt = 1;
#ifdef _WIN32
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
#else
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif

    sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port_);

    if (bind(server_fd, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR ||
        listen(server_fd, 5) == SOCKET_ERROR) {
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

        // Read WebSocket Handshake
        char buffer[2048] = {0};
        int bytes = recv(client_fd, buffer, sizeof(buffer) - 1, 0);
        if (bytes <= 0) {
            closesocket(client_fd);
            continue;
        }

        std::string req_str(buffer, bytes);
        size_t key_pos = req_str.find("Sec-WebSocket-Key:");
        if (key_pos == std::string::npos) {
            closesocket(client_fd);
            continue;
        }

        key_pos += 18;
        while (key_pos < req_str.size() && (req_str[key_pos] == ' ' || req_str[key_pos] == '\t')) key_pos++;
        size_t end_pos = req_str.find("\r\n", key_pos);
        if (end_pos == std::string::npos) end_pos = req_str.find('\n', key_pos);
        if (end_pos == std::string::npos) {
            closesocket(client_fd);
            continue;
        }

        std::string client_key = req_str.substr(key_pos, end_pos - key_pos);
        std::string accept_key = Utils::ComputeWebSocketAcceptKey(client_key);

        std::string response = 
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: " + accept_key + "\r\n\r\n";

        send(client_fd, response.c_str(), (int)response.length(), 0);

        {
            std::lock_guard<std::mutex> lock(client_mutex_);
            if (active_client_fd_ != 0 && (SOCKET)active_client_fd_ != INVALID_SOCKET) {
                closesocket((SOCKET)active_client_fd_);
            }
            active_client_fd_ = (uintptr_t)client_fd;
            client_connected_ = true;
        }
        Utils::Log("INFO", "Inbound WebSocket client connected for 30FPS stream");
    }
}

void WebSocketStreamer::StreamLoop() {
    bool force_idr = true;
    int frame_count = 0;
    int current_enc_w = 0;
    int current_enc_h = 0;

    while (running_) {
        bool should_stream = streaming_active_ || client_connected_;

        if (should_stream) {
            FrameData frame;
            if (capturer_->CaptureFrame(frame) && !frame.bgra_buffer.empty()) {
                if (current_enc_w != frame.width || current_enc_h != frame.height) {
                    encoder_->Initialize(frame.width, frame.height, 30, 3000);
                    current_enc_w = frame.width;
                    current_enc_h = frame.height;
                    force_idr = true;
                }

                std::vector<uint8_t> payload;
                bool is_h264 = false;
                bool is_keyframe = force_idr || (frame_count % 30 == 0);

                if (encoder_->EncodeFrame(frame.bgra_buffer.data(), is_keyframe, payload) && !payload.empty()) {
                    is_h264 = true;
                    force_idr = false;
                } else {
                    // Fallback to high-speed GDI+ JPEG streaming
                    ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, 1280, 720, 75, payload);
                }

                if (!payload.empty()) {
                    frame_count++;

                    if (frame_count == 1 || frame_count % 60 == 0) {
                        Utils::Log("INFO", "[StreamLoop] Encoded " + std::string(is_h264 ? "H.264" : "MJPEG") + " frame #" + std::to_string(frame_count) + 
                                   " (" + std::to_string(payload.size()) + " bytes, keyframe=" + (is_keyframe ? "true" : "false") + 
                                   "), sending outbound to Teacher Console");
                    }

                    std::lock_guard<std::mutex> lock(client_mutex_);

                    // 1. Send to Outbound Teacher Relay (Firewall Bypassing)
                    if (outbound_sock_ != 0) {
                        SendWsClientBinary(outbound_sock_, payload.data(), payload.size());
                    }

                    // 2. Send to Inbound Client (if connected directly)
                    if (active_client_fd_ != 0) {
                        std::vector<uint8_t> ws_frame;
                        ws_frame.push_back(0x82); // FIN = 1, Opcode = 2
                        size_t payload_len = payload.size();
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
                        ws_frame.insert(ws_frame.end(), payload.begin(), payload.end());

                        SOCKET client_sock = (SOCKET)active_client_fd_;
                        int sent = send(client_sock, (const char*)ws_frame.data(), (int)ws_frame.size(), 0);
                        if (sent <= 0) {
                            closesocket(client_sock);
                            active_client_fd_ = 0;
                            client_connected_ = false;
                        }
                    }
                }
            }
            Utils::SleepMs(33); // ~30 FPS
        } else {
            force_idr = true;
            Utils::SleepMs(100); // Idle when no active viewers
        }
    }
}

} // namespace GridSight
