#include "../include/capture.h"
#include "../include/beacon_client.h"
#include "../include/http_server.h"
#include "../include/ws_server.h"
#include "../include/rtp_receiver.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <memory>
#include <csignal>

#ifdef _WIN32
#include <windows.h>
#endif

std::atomic<bool> g_keep_running{true};

void SignalHandler(int signum) {
    g_keep_running = false;
}

#ifdef _WIN32
int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
#else
int main(int argc, char* argv[]) {
#endif
    signal(SIGINT, SignalHandler);
    signal(SIGTERM, SignalHandler);

    GridSight::Utils::Log("INFO", "GridSight Beacon (gs-agent) starting in Session 1...");

    // Load .env configuration
    GridSight::Utils::LoadEnv(".env");

    std::string multicast_ip = GridSight::Utils::GetEnv("MULTICAST_IP", "239.255.42.99");
    int multicast_port = GridSight::Utils::GetEnvInt("MULTICAST_PORT", 9001);
    int http_port = GridSight::Utils::GetEnvInt("HTTP_PORT", 8080);
    int ws_port = GridSight::Utils::GetEnvInt("WS_PORT", 8081);
    std::string rtp_ip = GridSight::Utils::GetEnv("RTP_IP", "239.255.42.100");
    int rtp_port = GridSight::Utils::GetEnvInt("RTP_PORT", 9000);

    auto capturer = std::make_shared<GridSight::ScreenCapturer>();
    if (!capturer->Initialize()) {
        GridSight::Utils::Log("ERROR", "Failed to initialize ScreenCapturer");
    }

    // 1. Start Beacon Discovery
    GridSight::BeaconClient beacon_client(multicast_ip, multicast_port);
    beacon_client.Start();

    // 2. Start HTTP Server for 1 FPS Snapshot Polling
    GridSight::HttpServer http_server(http_port, capturer);
    http_server.Start();

    // 3. Start WebSocket Server for On-demand 30 FPS Stream
    GridSight::WebSocketStreamer ws_streamer(ws_port, capturer);
    ws_streamer.Start();

    // 4. Start RTP Receiver for Teacher Multicast Broadcast
    GridSight::RTPReceiver rtp_receiver(rtp_ip, rtp_port);
    rtp_receiver.Start();

    GridSight::Utils::Log("INFO", "GridSight Beacon running.");

    while (g_keep_running) {
        GridSight::Utils::SleepMs(1000);
    }

    GridSight::Utils::Log("INFO", "GridSight Beacon shutting down...");
    rtp_receiver.Stop();
    ws_streamer.Stop();
    http_server.Stop();
    beacon_client.Stop();
    capturer->Release();

    return 0;
}
