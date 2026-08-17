#include "../include/beacon_client.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include "../include/http_server.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <random>
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

BeaconClient::BeaconClient(const std::string& multicast_ip, int port, std::shared_ptr<HttpServer> http_server)
    : multicast_ip_(multicast_ip), port_(port), http_server_(http_server) {}

BeaconClient::~BeaconClient() {
    Stop();
}

void BeaconClient::Start() {
    if (running_.exchange(true)) return;
    worker_thread_ = std::thread(&BeaconClient::DiscoveryLoop, this);
    Utils::Log("INFO", "BeaconClient started (Multicast " + multicast_ip_ + ":" + std::to_string(port_) + ")");
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

        std::ostringstream ss;
        ss << "{"
           << "\"type\":\"BEACON\","
           << "\"version\":\"5.3.0\","
           << "\"hostname\":\"" << net_info.hostname << "\","
           << "\"ip\":\"" << net_info.ip << "\","
           << "\"mac\":\"" << net_info.mac << "\","
           << "\"username\":\"" << net_info.username << "\","
           << "\"timestamp\":" << Utils::GetCurrentTimestampMs() << ","
           << "\"specs\":{"
           <<   "\"agent_version\":\"5.3.0\","
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
#else
            setsockopt(sock, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));
#endif

            sockaddr_in addr;
            memset(&addr, 0, sizeof(addr));
            addr.sin_family = AF_INET;
            addr.sin_port = htons(port_);
            inet_pton(AF_INET, multicast_ip_.c_str(), &addr.sin_addr);

            sendto(sock, payload.c_str(), (int)payload.length(), 0, (sockaddr*)&addr, sizeof(addr));

            // Listen for TOKEN_GRANT response
            ListenForToken((int)sock);

            closesocket(sock);
        }

        // Update heartbeat immediately after announcement
        Utils::UpdateHeartbeat();

        // Random jitter to prevent network broadcast storms from 70 PCs
        int sleep_time = jitter_dist(gen);
        Utils::SleepMs(sleep_time + 3000);
    }
}

void BeaconClient::ListenForToken(int socket_fd) {
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
                if (http_server_ && teacher_ip_str[0]) {
                    http_server_->SetTeacherHost(teacher_ip_str, 3001);
                }

                std::string response(buffer, bytes);
                // Simple JSON parsing to find token
                size_t token_pos = response.find("\"token\":\"");
                if (token_pos != std::string::npos) {
                    token_pos += 9;
                    size_t token_end = response.find("\"", token_pos);
                    if (token_end != std::string::npos) {
                        std::string token = response.substr(token_pos, token_end - token_pos);
                        TokenManager::Instance().SetSessionToken(token);
                        Utils::Log("INFO", "Received dynamic session token: " + token + " from teacher " + teacher_ip_str);
                    }
                }
            }
        }
    }
}

} // namespace GridSight
