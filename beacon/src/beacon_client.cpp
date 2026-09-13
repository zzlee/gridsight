#include "../include/beacon_client.h"
#include "../include/http_server.h"
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

BeaconClient::BeaconClient(const std::string& multicast_ip, int port,
                           std::shared_ptr<HttpServer> http_server,
                           std::shared_ptr<WebSocketStreamer> ws_streamer)
    : multicast_ip_(multicast_ip), port_(port),
      http_server_(std::move(http_server)), ws_streamer_(std::move(ws_streamer)) {}

BeaconClient::~BeaconClient() {
    Stop();
}

void BeaconClient::Start() {
    if (running_.exchange(true)) return;
    worker_thread_ = std::thread(&BeaconClient::DiscoveryListenLoop, this);
    Utils::Log("INFO", "BeaconClient discovery listener started (Multicast " + multicast_ip_ + ":" + std::to_string(port_) + ")");
}

void BeaconClient::Stop() {
    if (!running_.exchange(false)) return;
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
    Utils::Log("INFO", "BeaconClient stopped");
}

// Listen for the teacher console's periodic "DISCOVERY" multicast
// announcement and adopt its teacherIp/teacherPort for outbound traffic.
void BeaconClient::DiscoveryListenLoop() {
    while (running_) {
        SOCKET sock = socket(AF_INET, SOCK_DGRAM, 0);
        if (sock == INVALID_SOCKET) {
            Utils::Log("WARN", "BeaconClient UDP socket creation failed");
            if (running_) Utils::SleepMs(3000);
            continue;
        }

        int reuse = 1;
        setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
#ifdef SO_REUSEPORT
        setsockopt(sock, SOL_SOCKET, SO_REUSEPORT, (const char*)&reuse, sizeof(reuse));
#endif

        sockaddr_in local_addr;
        memset(&local_addr, 0, sizeof(local_addr));
        local_addr.sin_family = AF_INET;
        local_addr.sin_port = htons((uint16_t)port_);
        local_addr.sin_addr.s_addr = htonl(INADDR_ANY);
        if (bind(sock, (sockaddr*)&local_addr, sizeof(local_addr)) == SOCKET_ERROR) {
            Utils::Log("WARN", "BeaconClient bind failed on port " + std::to_string(port_));
            closesocket(sock);
            if (running_) Utils::SleepMs(3000);
            continue;
        }

        // Join the multicast group on the primary physical NIC.
        NetworkInfo net = Utils::GetSystemNetworkInfo();
        bool joined = false;
        if (inet_pton(AF_INET, multicast_ip_.c_str(), &local_addr.sin_addr) == 1) {
            ip_mreq mreq;
            memset(&mreq, 0, sizeof(mreq));
            mreq.imr_multiaddr.s_addr = local_addr.sin_addr.s_addr;
            if (!net.ip.empty() && net.ip != "127.0.0.1" && inet_pton(AF_INET, net.ip.c_str(), &mreq.imr_interface) == 1) {
                if (setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP, (const char*)&mreq, sizeof(mreq)) == 0) {
                    joined = true;
                } else {
                    Utils::Log("WARN", "BeaconClient IGMP join failed on interface " + net.ip);
                }
            }
            if (!joined) {
                mreq.imr_interface.s_addr = htonl(INADDR_ANY);
                if (setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP, (const char*)&mreq, sizeof(mreq)) == 0) {
                    joined = true;
                }
            }
        }
        if (!joined) {
            closesocket(sock);
            if (running_) Utils::SleepMs(3000);
            continue;
        }

        Utils::Log("INFO", "BeaconClient joined multicast group " + multicast_ip_ + ":" + std::to_string(port_));

        // Short recv timeout so the loop can observe the running_ flag.
#ifdef _WIN32
        DWORD timeout_ms = 1500;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout_ms, sizeof(timeout_ms));
#else
        timeval timeout = {1, 500000};
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
#endif

        while (running_) {
            char buffer[2048] = {0};
            sockaddr_in from_addr;
#ifdef _WIN32
            int from_len = sizeof(from_addr);
#else
            socklen_t from_len = sizeof(from_addr);
#endif
            int bytes = recvfrom(sock, buffer, sizeof(buffer) - 1, 0, (sockaddr*)&from_addr, &from_len);
            if (bytes > 0) {
                std::string payload(buffer, bytes);
                const std::string type = Utils::ExtractJsonField(payload, "type");
                if (type != "DISCOVERY") continue;
                const std::string teacher_ip = Utils::ExtractJsonField(payload, "teacherIp");
                if (teacher_ip.empty()) continue;
                int teacher_port = 3000;
                const std::string port_str = Utils::ExtractJsonField(payload, "teacherPort");
                if (!port_str.empty()) {
                    try {
                        teacher_port = std::stoi(port_str);
                    } catch (...) {
                        teacher_port = 3000;
                    }
                }
                if (http_server_) http_server_->SetTeacherHost(teacher_ip, teacher_port);
                if (ws_streamer_) ws_streamer_->SetTeacherHost(teacher_ip, teacher_port);
                Utils::Log("INFO", "✅ [Discovery] Teacher online from " + teacher_ip + ":" + std::to_string(teacher_port));
            }
            Utils::UpdateHeartbeat("beacon");
        }

        closesocket(sock);
        Utils::UpdateHeartbeat();
    }
}

} // namespace GridSight