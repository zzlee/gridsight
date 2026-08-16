#pragma once
#include "utils.h"
#include <atomic>
#include <thread>
#include <string>

namespace GridSight {

class BeaconClient {
public:
    BeaconClient(const std::string& multicast_ip = "239.255.42.99", int port = 9001);
    ~BeaconClient();

    void Start();
    void Stop();

private:
    void DiscoveryLoop();
    void SendBeaconAnnouncement(int socket_fd, const NetworkInfo& info);
    void ListenForToken(int socket_fd);

    std::string multicast_ip_;
    int port_;
    std::atomic<bool> running_{false};
    std::thread worker_thread_;
};

} // namespace GridSight
