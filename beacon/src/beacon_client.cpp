#include "../include/beacon_client.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <random>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

namespace GridSight {

BeaconClient::BeaconClient(const std::string& multicast_ip, int port)
    : multicast_ip_(multicast_ip), port_(port) {}

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
        // Send UDP announcement
        std::string payload = "{"type":"BEACON","hostname":"" + net_info.hostname +
                              "","ip":"" + net_info.ip +
                              "","mac":"" + net_info.mac +
                              "","username":"" + net_info.username +
                              "","timestamp":" + std::to_string(Utils::GetCurrentTimestampMs()) + "}";

#ifdef _WIN32
        SOCKET sock = socket(AF_INET, SOCK_DGRAM, 0);
        if (sock != INVALID_SOCKET) {
            sockaddr_in addr = {0};
            addr.sin_family = AF_INET;
            addr.sin_port = htons(port_);
            inet_pton(AF_INET, multicast_ip_.c_str(), &addr.sin_addr);

            sendto(sock, payload.c_str(), (int)payload.length(), 0, (sockaddr*)&addr, sizeof(addr));
            closesocket(sock);
        }
#endif

        // Random jitter to prevent network broadcast storms from 70 PCs
        int sleep_time = jitter_dist(gen);
        Utils::SleepMs(sleep_time + 3000);
    }
}

} // namespace GridSight
