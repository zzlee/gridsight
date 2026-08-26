#pragma once
#include "utils.h"
#include <atomic>
#include <thread>
#include <string>
#include <memory>

namespace GridSight {

class HttpServer;
class WebSocketStreamer;

class BeaconClient {
public:
    BeaconClient(const std::string& multicast_ip = "239.255.42.99", int port = 8888,
                 std::shared_ptr<HttpServer> http_server = nullptr,
                 std::shared_ptr<WebSocketStreamer> ws_streamer = nullptr,
                 const std::string& hmac_secret = "");
    ~BeaconClient();

    void Start();
    void Stop();

private:
    void DiscoveryLoop();
    void SendBeaconAnnouncement(int socket_fd, const NetworkInfo& info);
    void ListenForToken(int socket_fd, const std::string& agent_mac);

    std::string multicast_ip_;
    int port_;
    std::shared_ptr<HttpServer> http_server_;
    std::shared_ptr<WebSocketStreamer> ws_streamer_;
    std::string hmac_secret_;
    std::atomic<bool> running_{false};
    std::thread worker_thread_;
};

} // namespace GridSight
