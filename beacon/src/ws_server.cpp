#include "../include/ws_server.h"
#include "../include/utils.h"
#include <iostream>

namespace GridSight {

WebSocketStreamer::WebSocketStreamer(int port, std::shared_ptr<ScreenCapturer> capturer)
    : port_(port), capturer_(capturer), encoder_(std::make_unique<H264Encoder>()) {}

WebSocketStreamer::~WebSocketStreamer() {
    Stop();
}

bool WebSocketStreamer::Start() {
    if (running_.exchange(true)) return true;
    encoder_->Initialize(1280, 720, 30, 2500);
    accept_thread_ = std::thread(&WebSocketStreamer::AcceptLoop, this);
    stream_thread_ = std::thread(&WebSocketStreamer::StreamLoop, this);
    Utils::Log("INFO", "WebSocketStreamer running on port " + std::to_string(port_));
    return true;
}

void WebSocketStreamer::Stop() {
    if (!running_.exchange(false)) return;
    if (accept_thread_.joinable()) accept_thread_.join();
    if (stream_thread_.joinable()) stream_thread_.join();
    encoder_->Release();
}

void WebSocketStreamer::AcceptLoop() {
    // In production, accept WS handshakes and manage active connection
    while (running_) {
        Utils::SleepMs(500);
    }
}

void WebSocketStreamer::StreamLoop() {
    while (running_) {
        if (client_connected_) {
            FrameData frame;
            if (capturer_->CaptureFrame(frame)) {
                std::vector<uint8_t> nalu;
                encoder_->EncodeFrame(frame.bgra_buffer.data(), false, nalu);
                // Send NALU to active client socket
            }
        }
        Utils::SleepMs(33); // ~30 FPS
    }
}

} // namespace GridSight
