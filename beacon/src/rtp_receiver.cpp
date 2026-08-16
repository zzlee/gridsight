#include "../include/rtp_receiver.h"
#include "../include/utils.h"
#include <iostream>

namespace GridSight {

RTPReceiver::RTPReceiver(const std::string& multicast_ip, int port)
    : multicast_ip_(multicast_ip), port_(port) {}

RTPReceiver::~RTPReceiver() {
    Stop();
}

bool RTPReceiver::Start() {
    if (running_.exchange(true)) return true;
    receive_thread_ = std::thread(&RTPReceiver::ReceiveLoop, this);
    Utils::Log("INFO", "RTPReceiver listening on " + multicast_ip_ + ":" + std::to_string(port_));
    return true;
}

void RTPReceiver::Stop() {
    if (!running_.exchange(false)) return;
    if (receive_thread_.joinable()) receive_thread_.join();
    CloseOverlayWindow();
}

void RTPReceiver::ReceiveLoop() {
    // Join IGMP Multicast group 239.255.42.100:9000
    // Receive RTP packets, depayload H.264, render to D3D11 / TopMost window
    while (running_) {
        Utils::SleepMs(100);
    }
}

void RTPReceiver::CreateFullScreenOverlayWindow() {
    // D3D11 / Topmost borderless fullscreen overlay for teacher broadcast
    overlay_active_ = true;
}

void RTPReceiver::RenderFrame(const uint8_t* h264_data, size_t size) {
    // Hardware video decoding and presentation
}

void RTPReceiver::CloseOverlayWindow() {
    overlay_active_ = false;
}

} // namespace GridSight
