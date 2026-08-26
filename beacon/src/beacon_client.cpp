#include "../include/beacon_client.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include "../include/http_server.h"
#include "../include/ws_server.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <random>
#include <cstring>
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

BeaconClient::BeaconClient(const std::string& multicast_ip, int port,
                           std::shared_ptr<HttpServer> http_server,
                           std::shared_ptr<WebSocketStreamer> ws_streamer,
                           const std::string& hmac_secret)
    : multicast_ip_(multicast_ip), port_(port), http_server_(std::move(http_server)),
      ws_streamer_(std::move(ws_streamer)), hmac_secret_(hmac_secret) {}

BeaconClient::~BeaconClient() {
    Stop();
}

void BeaconClient::Start() {
    if (running_.exchange(true)) return;
    worker_thread_ = std::thread(&BeaconClient::DiscoveryLoop, this);
    Utils::Log("INFO", "BeaconClient worker thread started (Multicast target " + multicast_ip_ + ":" + std::to_string(port_) + ")");
}

void BeaconClient::Stop() {
    if (!running_.exchange(false)) return;
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
    Utils::Log("INFO", "BeaconClient stopped");
}

void BeaconClient::DiscoveryLoop() {
    NetworkInfo net_info = Utils::GetSystemNetworkInfo();
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<int> jitter_dist(500, 2000);

    while (running_) {
        // Collect latest hardware telemetry
        SystemHardwareInfo hw = Utils::GetSystemHardwareInfo();

        std::string win_title = Utils::GetActiveWindowTitle();
        std::ostringstream esc_win;
        for (char c : win_title) {
            if (c == '"') esc_win << "\\\"";
            else if (c == '\\') esc_win << "\\\\";
            else if (c == '\b') esc_win << "\\b";
            else if (c == '\f') esc_win << "\\f";
            else if (c == '\n') esc_win << "\\n";
            else if (c == '\r') esc_win << "\\r";
            else if (c == '\t') esc_win << "\\t";
            else if ((unsigned char)c >= 0x20) esc_win << c;
        }

        std::ostringstream ss;
        ss << "{"
           << "\"type\":\"BEACON\","
           << "\"version\":\"5.5.0\","
           << "\"hostname\":\"" << net_info.hostname << "\","
           << "\"ip\":\"" << net_info.ip << "\","
           << "\"mac\":\"" << net_info.mac << "\","
           << "\"username\":\"" << net_info.username << "\","
           << "\"active_window\":\"" << esc_win.str() << "\","
           << "\"timestamp\":" << Utils::GetCurrentTimestampMs() << ","
           << "\"specs\":{"
           <<   "\"agent_version\":\"5.5.0\","
           <<   "\"os\":\"" << hw.os_name << "\","
           <<   "\"uptime\":" << hw.uptime_seconds << ","
           <<   "\"cpu\":{\"model\":\"" << hw.cpu_model << "\",\"cores\":" << hw.cpu_cores << ",\"usage_percent\":" << hw.cpu_usage_percent << "},"
           <<   "\"ram\":{\"total_mb\":" << hw.ram_total_mb << ",\"avail_mb\":" << hw.ram_avail_mb << ",\"usage_percent\":" << hw.ram_usage_percent << "},"
           <<   "\"disk\":{\"drive\":\"" << hw.disk_drive << "\",\"total_gb\":" << hw.disk_total_gb << ",\"free_gb\":" << hw.disk_free_gb << ",\"usage_percent\":" << hw.disk_usage_percent << "}"
           << "}"
           << "}";
        std::string payload = ss.str();

        SOCKET sock = socket(AF_INET, SOCK_DGRAM, 0);
        if (sock != INVALID_SOCKET) {
            int ttl = 2;
#ifdef _WIN32
            setsockopt(sock, IPPROTO_IP, IP_MULTICAST_TTL, (const char*)&ttl, sizeof(ttl));
            in_addr local_interface;
            if (inet_pton(AF_INET, net_info.ip.c_str(), &local_interface) == 1) {
                setsockopt(sock, IPPROTO_IP, IP_MULTICAST_IF, (const char*)&local_interface, sizeof(local_interface));
            }
#else
            setsockopt(sock, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));
#endif

            sockaddr_in addr;
            memset(&addr, 0, sizeof(addr));
            addr.sin_family = AF_INET;
            addr.sin_port = htons(port_);
            if (inet_pton(AF_INET, multicast_ip_.c_str(), &addr.sin_addr) != 1) {
                Utils::Log("ERROR", "BeaconClient invalid multicast IPv4 address: " + multicast_ip_);
                closesocket(sock);
                Utils::UpdateHeartbeat();
                Utils::SleepMs(5000);
                continue;
            }

            int sent = sendto(sock, payload.c_str(), (int)payload.length(), 0, (sockaddr*)&addr, sizeof(addr));
            if (sent == SOCKET_ERROR) {
#ifdef _WIN32
                Utils::Log("WARN", "BeaconClient multicast send failed (error " + std::to_string(WSAGetLastError()) + ")");
#else
                Utils::Log("WARN", "BeaconClient multicast send failed");
#endif
            } else {
                // Listen for TOKEN_GRANT only after a beacon was sent.
                ListenForToken((int)sock, net_info.mac);
            }

            closesocket(sock);
        } else {
#ifdef _WIN32
            Utils::Log("WARN", "BeaconClient UDP socket creation failed (error " + std::to_string(WSAGetLastError()) + ")");
#else
            Utils::Log("WARN", "BeaconClient UDP socket creation failed");
#endif
        }

        // Process-level heartbeat drives the watchdog; the named heartbeat is
        // exposed separately through component diagnostics.
        Utils::UpdateHeartbeat();
        Utils::UpdateHeartbeat("beacon");

        // Random jitter to prevent network broadcast storms from 70 PCs
        int sleep_time = jitter_dist(gen);
        Utils::SleepMs(sleep_time + 3000);
    }
}

void BeaconClient::ListenForToken(int socket_fd, const std::string& agent_mac) {
    SOCKET sock = (SOCKET)socket_fd;

    fd_set readfds;
    FD_ZERO(&readfds);
    FD_SET(sock, &readfds);

    timeval tv;
    tv.tv_sec = 2; // Wait up to 2 seconds for a token grant
    tv.tv_usec = 0;

    int ret = select((int)sock + 1, &readfds, NULL, NULL, &tv);
    if (ret > 0) {
        if (FD_ISSET(sock, &readfds)) {
            char buffer[1024] = {0};
            sockaddr_in from_addr;
            socklen_t from_len = sizeof(from_addr);

            int bytes = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (sockaddr*)&from_addr, &from_len);
            if (bytes > 0) {
                // Extract teacher console IP from sender
                char teacher_ip_str[INET_ADDRSTRLEN] = {0};
                inet_ntop(AF_INET, &(from_addr.sin_addr), teacher_ip_str, INET_ADDRSTRLEN);

                std::string response(buffer, bytes);

                // Parse string fields with the shared escape-aware helper. This
                // avoids brittle prefix offsets (the old signature parser
                // started on the opening quote and always produced an empty
                // signature when HMAC verification was enabled).
                const std::string message_type = Utils::ExtractJsonField(response, "type");
                const std::string token = Utils::ExtractJsonField(response, "token");
                const std::string signature = Utils::ExtractJsonField(response, "signature");
                if (message_type != "TOKEN_GRANT" || token.empty()) {
                    Utils::Log("WARN", "[Beacon] Ignoring malformed token response from " + std::string(teacher_ip_str));
                    return;
                }

                // HMAC verification: only trust tokens signed by the real server
                if (!hmac_secret_.empty()) {
                    if (signature.empty()) {
                        Utils::Log("WARN", "⚠️ [Beacon] TOKEN_GRANT missing HMAC signature, ignoring from " + std::string(teacher_ip_str));
                        return;
                    }
                    std::string expected_data = token + "|" + agent_mac;
                    if (!Utils::VerifyHMACSHA256(hmac_secret_, expected_data, signature)) {
                        Utils::Log("WARN", "⚠️ [Beacon] TOKEN_GRANT HMAC mismatch! Possible spoof from " + std::string(teacher_ip_str));
                        return;
                    }
                    Utils::Log("INFO", "✅ [Beacon] TOKEN_GRANT HMAC verified from " + std::string(teacher_ip_str));
                }

                // HMAC passed (or no secret configured) — accept the token
                if (teacher_ip_str[0]) {
                    if (http_server_) http_server_->SetTeacherHost(teacher_ip_str, 3000);
                    if (ws_streamer_) ws_streamer_->SetTeacherHost(teacher_ip_str, 3000);
                }
                TokenManager::Instance().SetSessionToken(token);
                Utils::Log("INFO", "Received verified dynamic session token from teacher " + std::string(teacher_ip_str));
            }
        }
    }
}

} // namespace GridSight
