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
                 std::shared_ptr<WebSocketStreamer> ws_streamer = nullptr);
    ~BeaconClient();

    void Start();
    void Stop();

private:
    void DiscoveryListenLoop();

    std::string multicast_ip_;
    int port_;
    std::shared_ptr<HttpServer> http_server_;
    std::shared_ptr<WebSocketStreamer> ws_streamer_;
    std::atomic<bool> running_{false};
    std::thread worker_thread_;
    std::string last_teacher_ip_;
    int last_teacher_port_ = 0;
};

} // namespace GridSight