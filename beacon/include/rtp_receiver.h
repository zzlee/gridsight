#pragma once
#include <atomic>
#include <cstdint>
#include <thread>
#include <string>
#include <vector>

namespace GridSight {

class RTPReceiver {
public:
    RTPReceiver(const std::string& multicast_ip = "239.255.42.100", int port = 9000);
    ~RTPReceiver();

    bool Start();
    void Stop();

private:
    void ReceiveLoop();
    void UIThreadLoop();
    void CreateFullScreenOverlayWindow();
    void RenderFrame(const uint8_t* h264_data, size_t size);
    void CloseOverlayWindow();
    void AppendAccessUnitNAL(const uint8_t* nal, size_t size, bool is_idr);
    void FlushAccessUnit();

    std::string multicast_ip_;
    int port_;
    std::atomic<bool> running_{false};
    std::atomic<bool> overlay_active_{false};
    std::thread receive_thread_;
    std::thread ui_thread_;
    void* hwnd_overlay_ = nullptr;
    void* decoder_ = nullptr;

    // RTP stream state
    bool rtp_stream_initialized_ = false;
    uint16_t rtp_last_seq_ = 0;
    uint32_t rtp_ssrc_ = 0;

    // FU-A reassembly state
    bool fua_active_ = false;
    uint16_t fua_last_seq_ = 0;
    uint32_t fua_timestamp_ = 0;
    uint32_t fua_ssrc_ = 0;

    // RTP/H.264 access-unit assembly state.
    std::vector<uint8_t> access_unit_buffer_;
    uint32_t access_unit_timestamp_ = 0;
    bool access_unit_active_ = false;
    bool access_unit_has_idr_ = false;
    bool access_unit_corrupt_ = false;
};

} // namespace GridSight
