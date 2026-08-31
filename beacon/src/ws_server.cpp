#include "../include/ws_server.h"
#include "../include/utils.h"
#include "../include/token_manager.h"
#include "../include/rtp_receiver.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstring>
#include <vector>
#include <cerrno>
#include <exception>
#include <random>
#include <algorithm>
#include <cstddef>

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

namespace {
int LastWebSocketError() {
#ifdef _WIN32
    return WSAGetLastError();
#else
    return errno;
#endif
}

void ShutdownSocket(SOCKET socket_fd) {
    if (socket_fd == INVALID_SOCKET || socket_fd == 0) return;
#ifdef _WIN32
    shutdown(socket_fd, SD_BOTH);
#else
    shutdown(socket_fd, SHUT_RDWR);
#endif
}
} // namespace

WebSocketStreamer::WebSocketStreamer(std::shared_ptr<ScreenCapturer> capturer)
    : capturer_(capturer), encoder_(std::make_unique<H264Encoder>()) {}

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
    const bool h264_ready = encoder_->Initialize(1280, 720, 30, 2500);
    if (!h264_ready) {
        Utils::Log("WARN", "H.264 encoder initialization failed; focus streaming will use MJPEG fallback");
    }

    try {
        outbound_thread_ = std::thread(&WebSocketStreamer::ConnectOutboundLoop, this);
        stream_thread_ = std::thread(&WebSocketStreamer::StreamLoop, this);
    } catch (const std::exception& err) {
        Utils::Log("ERROR", "WebSocketStreamer thread startup failed: " + std::string(err.what()));
        Stop();
        return false;
    }

    Utils::Log("INFO", "WebSocket reverse outbound client and stream worker threads started");
    return true;
}

void WebSocketStreamer::Stop() {
    if (!running_.exchange(false)) return;

    {
        std::lock_guard<std::mutex> lock(client_mutex_);
        ShutdownSocket((SOCKET)outbound_sock_);
        streaming_active_ = false;
    }

    if (outbound_thread_.joinable()) outbound_thread_.join();
    if (stream_thread_.joinable()) stream_thread_.join();

    {
        std::lock_guard<std::mutex> lock(client_mutex_);
        if (outbound_sock_ != 0 && (SOCKET)outbound_sock_ != INVALID_SOCKET) {
            closesocket((SOCKET)outbound_sock_);
            outbound_sock_ = 0;
        }
    }
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
#ifdef _WIN32
        DWORD outbound_timeout = 3000;
        setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&outbound_timeout, sizeof(outbound_timeout));
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&outbound_timeout, sizeof(outbound_timeout));
#else
        struct timeval outbound_timeout = {3, 0};
        setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &outbound_timeout, sizeof(outbound_timeout));
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &outbound_timeout, sizeof(outbound_timeout));
#endif
        {
            std::lock_guard<std::mutex> lock(client_mutex_);
            if (!running_) {
                closesocket(s);
                break;
            }
            outbound_sock_ = (uintptr_t)s;
        }

        sockaddr_in addr = {0};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(port);
        inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

        if (connect(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
            Utils::Log("ERROR", "❌ Outbound connect to teacher " + host + ":" + std::to_string(port) + " failed (error " + std::to_string(LastWebSocketError()) + ")");
            {
                std::lock_guard<std::mutex> lock(client_mutex_);
                if (outbound_sock_ == (uintptr_t)s) outbound_sock_ = 0;
            }
            closesocket(s);
            if (running_) Utils::SleepMs(2000);
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
            Utils::UpdateHeartbeat("ws-connected");

            // Receive commands (START_STREAM / STOP_STREAM / GET_HIGHRES_SNAPSHOT / GET_LOGS etc)
            ReceiveCommands((uintptr_t)s);
            if (running_) {
                Utils::Log("WARN", "Reverse WebSocket disconnected, retrying...");
            }
        } else {
            std::string err_reason = "unknown";
            if (rec <= 0) {
                err_reason = "recv timeout or peer closed (error " + std::to_string(LastWebSocketError()) + ")";
            } else {
                err_reason = "rejected by server: " + std::string(buf, rec > 256 ? 256 : rec);
            }
            Utils::Log("ERROR", "❌ Reverse WebSocket handshake failed with " + host + ": " + err_reason);
        }

        {
            std::lock_guard<std::mutex> lock(client_mutex_);
            if (outbound_sock_ == (uintptr_t)s) {
                outbound_sock_ = 0;
            }
            streaming_active_ = false;
        }
        closesocket(s);
        if (running_) Utils::SleepMs(2000);
    }
}

void WebSocketStreamer::ReceiveCommands(uintptr_t sock_fd) {
    SOCKET sock = (SOCKET)sock_fd;
    std::vector<uint8_t> pending;
    std::vector<uint8_t> fragmented_payload;
    uint8_t fragmented_opcode = 0;
    uint8_t buffer[4096];
    constexpr uint64_t kMaxCommandBytes = 1024 * 1024;

    while (running_) {
        const int bytes = recv(sock, reinterpret_cast<char*>(buffer), sizeof(buffer), 0);
        if (bytes < 0) {
            const int recv_err = LastWebSocketError();
#ifdef _WIN32
            const bool is_timeout = (recv_err == WSAETIMEDOUT || recv_err == WSAEWOULDBLOCK);
#else
            const bool is_timeout = (recv_err == EAGAIN || recv_err == EWOULDBLOCK);
#endif
            if (is_timeout) continue;
            break; // genuine error
        }
        if (bytes == 0) break; // peer closed cleanly
        Utils::UpdateHeartbeat("ws-rx");
        pending.insert(pending.end(), buffer, buffer + bytes);

        while (pending.size() >= 2) {
            const bool fin = (pending[0] & 0x80) != 0;
            const uint8_t opcode = pending[0] & 0x0F;
            const bool masked = (pending[1] & 0x80) != 0;
            uint64_t payload_len = pending[1] & 0x7F;
            size_t header_len = 2;

            if (payload_len == 126) {
                if (pending.size() < 4) break;
                payload_len = (static_cast<uint64_t>(pending[2]) << 8) | pending[3];
                header_len = 4;
            } else if (payload_len == 127) {
                if (pending.size() < 10) break;
                payload_len = 0;
                for (size_t i = 2; i < 10; ++i) payload_len = (payload_len << 8) | pending[i];
                header_len = 10;
            }

            if (payload_len > kMaxCommandBytes || ((opcode & 0x08) && (!fin || payload_len > 125))) {
                Utils::Log("WARN", "WebSocket command frame violated size/control-frame limits");
                return;
            }

            uint8_t mask_key[4] = {0};
            if (masked) {
                if (pending.size() < header_len + 4) break;
                memcpy(mask_key, pending.data() + header_len, 4);
                header_len += 4;
            }
            if (pending.size() < header_len + payload_len) break;

            std::vector<uint8_t> payload(static_cast<size_t>(payload_len));
            for (size_t i = 0; i < payload.size(); ++i) {
                payload[i] = pending[header_len + i] ^ (masked ? mask_key[i % 4] : 0);
            }
            pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(header_len + payload.size()));

            if (opcode == 0x8) return; // close
            if (opcode == 0x9) {       // ping
                SendWsClientFrame(sock_fd, 0xA, payload.data(), payload.size());
                continue;
            }
            if (opcode == 0xA) continue; // pong

            if (opcode == 0x1 || opcode == 0x2) {
                if (fragmented_opcode != 0) return;
                if (fin) {
                    if (opcode == 0x1) HandleCommandMessage(sock_fd, std::string(payload.begin(), payload.end()));
                } else {
                    fragmented_opcode = opcode;
                    fragmented_payload = std::move(payload);
                }
            } else if (opcode == 0x0) {
                if (fragmented_opcode == 0 || fragmented_payload.size() + payload.size() > kMaxCommandBytes) return;
                fragmented_payload.insert(fragmented_payload.end(), payload.begin(), payload.end());
                if (fin) {
                    if (fragmented_opcode == 0x1) {
                        HandleCommandMessage(sock_fd, std::string(fragmented_payload.begin(), fragmented_payload.end()));
                    }
                    fragmented_payload.clear();
                    fragmented_opcode = 0;
                }
            } else {
                return;
            }
        }
    }
}

void WebSocketStreamer::HandleCommandMessage(uintptr_t sock_fd, const std::string& message) {
    const std::string action = Utils::ExtractJsonField(message, "action");
    if (action == "START_STREAM") {
        Utils::Log("INFO", "🎯 [Stream Command] Received START_STREAM from Teacher Console, activating 30 FPS H.264 stream");
        streaming_active_ = true;
    } else if (action == "STOP_STREAM") {
        Utils::Log("INFO", "🛑 [Stream Command] Received STOP_STREAM from Teacher Console, pausing stream");
        streaming_active_ = false;
    } else if (action == "STOP_BROADCAST") {
        Utils::Log("INFO", "🛑 [Broadcast Command] Received STOP_BROADCAST from Teacher Console, closing overlay window immediately");
        RTPReceiver::RequestCloseOverlay();
    } else if (action == "OPEN_URL") {
        const std::string url = Utils::ExtractJsonField(message, "url");
        if (!url.empty()) std::thread([url]() { Utils::OpenUrl(url); }).detach();
    } else if (action == "SHARE_FILE") {
        const std::string url = Utils::ExtractJsonField(message, "url");
        const std::string filename = Utils::ExtractJsonField(message, "filename");
        if (!url.empty()) std::thread([url, filename]() { Utils::DownloadAndOpenFile(url, filename); }).detach();
    } else if (action == "SHUTDOWN") {
        const std::string timeout_str = Utils::ExtractJsonField(message, "timeout");
        int timeout_sec = 30;
        if (!timeout_str.empty()) {
            try {
                timeout_sec = std::stoi(timeout_str);
            } catch (...) {
                timeout_sec = 30;
            }
        }
        if (timeout_sec <= 0) timeout_sec = 30;
        Utils::Log("INFO", "⚡ [Power Command] Received SHUTDOWN request from Teacher Console (countdown: " + std::to_string(timeout_sec) + "s)");
        std::thread([timeout_sec]() { Utils::TriggerShutdownCountdown(timeout_sec); }).detach();
    } else if (action == "GET_HIGHRES_SNAPSHOT") {
        Utils::Log("INFO", "📸 [Command] Received GET_HIGHRES_SNAPSHOT request from Teacher Console");
        FrameData frame;
        if (capturer_ && capturer_->CaptureFrame(frame)) {
            std::vector<uint8_t> jpeg_bytes;
            if (ImageEncoder::EncodeToJPEG(frame.bgra_buffer.data(), frame.width, frame.height, frame.width, frame.height, 85, jpeg_bytes)) {
                const std::string b64 = Utils::Base64Encode(jpeg_bytes.data(), jpeg_bytes.size());
                const std::string response = "{\"action\":\"HIGHRES_SNAPSHOT_REPORT\",\"image\":\"" + b64 + "\"}";
                SendWsClientText(sock_fd, response);
            }
        }
    } else if (action == "GET_LOGS") {
        std::string log_path = "gs-agent.log";
#ifdef _WIN32
        char temp_dir[MAX_PATH] = {0};
        if (GetTempPathA(MAX_PATH, temp_dir)) log_path = std::string(temp_dir) + "gs-agent.log";
#endif
        std::ifstream log_file(log_path, std::ios::binary);
        std::string content;
        if (log_file.is_open()) {
            log_file.seekg(0, std::ios::end);
            const size_t file_size = static_cast<size_t>(log_file.tellg());
            const size_t read_size = std::min<size_t>(file_size, 262144);
            log_file.seekg(static_cast<std::streamoff>(file_size - read_size));
            content.resize(read_size);
            log_file.read(content.data(), static_cast<std::streamsize>(read_size));
        }
        const std::string response = "{\"action\":\"LOGS_REPORT\",\"logs\":" + Utils::JsonEscape(content) + "}";
        SendWsClientText(sock_fd, response);
    }
}

bool WebSocketStreamer::SendWsClientFrame(uintptr_t sock_fd, uint8_t opcode, const uint8_t* data, size_t len) {
    SOCKET sock = (SOCKET)sock_fd;
    if (sock == INVALID_SOCKET || sock == 0 || (len > 0 && !data)) return false;
    std::lock_guard<std::mutex> send_lock(send_mutex_);

    std::vector<uint8_t> frame;
    frame.reserve(len + 14);
    frame.push_back(static_cast<uint8_t>(0x80 | (opcode & 0x0F)));
    if (len <= 125) {
        frame.push_back(static_cast<uint8_t>(0x80 | len));
    } else if (len <= 65535) {
        frame.push_back(0x80 | 126);
        frame.push_back(static_cast<uint8_t>((len >> 8) & 0xFF));
        frame.push_back(static_cast<uint8_t>(len & 0xFF));
    } else {
        frame.push_back(0x80 | 127);
        for (int i = 7; i >= 0; --i) frame.push_back(static_cast<uint8_t>((static_cast<uint64_t>(len) >> (i * 8)) & 0xFF));
    }

    static thread_local std::mt19937 random_engine(std::random_device{}());
    static thread_local std::uniform_int_distribution<int> byte_distribution(0, 255);
    uint8_t mask_key[4];
    for (uint8_t& byte : mask_key) {
        byte = static_cast<uint8_t>(byte_distribution(random_engine));
        frame.push_back(byte);
    }
    const size_t payload_offset = frame.size();
    frame.resize(payload_offset + len);
    for (size_t i = 0; i < len; ++i) frame[payload_offset + i] = data[i] ^ mask_key[i % 4];

    size_t total_sent = 0;
    while (total_sent < frame.size()) {
        const int sent = send(sock, reinterpret_cast<const char*>(frame.data() + total_sent),
                              static_cast<int>(frame.size() - total_sent), 0);
        if (sent <= 0) return false;
        total_sent += static_cast<size_t>(sent);
    }
    Utils::UpdateHeartbeat("ws-tx");
    return true;
}

void WebSocketStreamer::SendWsClientText(uintptr_t sock_fd, const std::string& text) {
    if (!text.empty()) SendWsClientFrame(sock_fd, 0x1, reinterpret_cast<const uint8_t*>(text.data()), text.size());
}

void WebSocketStreamer::SendWsClientBinary(uintptr_t sock_fd, const uint8_t* data, size_t len) {
    if (len > 0) SendWsClientFrame(sock_fd, 0x2, data, len);
}

void WebSocketStreamer::StreamLoop() {
    bool force_idr = true;
    int frame_count = 0;
    int current_enc_w = 0;
    int current_enc_h = 0;

    while (running_) {
        bool should_stream = streaming_active_;

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
                    Utils::UpdateHeartbeat("encoder");
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

                    // Send to Outbound Teacher Relay
                    if (outbound_sock_ != 0) {
                        SendWsClientBinary(outbound_sock_, payload.data(), payload.size());
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
