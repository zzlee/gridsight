#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
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
    static void RequestCloseOverlay();

private:
    void ReceiveLoop();
    void DecodeThreadLoop();
    void UIThreadLoop();
    void CreateFullScreenOverlayWindow();
    void EnqueueAU(std::vector<uint8_t> au);
    void RenderFrame(const uint8_t* h264_data, size_t size);
    void CloseOverlayWindow();
    void AppendAccessUnitNAL(const uint8_t* nal, size_t size, bool is_idr);
    void FlushAccessUnit();

    std::string multicast_ip_;
    int port_;
    std::atomic<bool> running_{false};
    std::atomic<bool> overlay_active_{false};
    std::thread receive_thread_;
    std::thread decode_thread_;
    std::thread ui_thread_;
    std::atomic<uintptr_t> socket_fd_{0};
    void* hwnd_overlay_ = nullptr;
    void* decoder_ = nullptr;

    // Bounded access-unit queue feeding the dedicated decode thread.
    // The receive loop only does fast RTP parsing/assembly and enqueues
    // complete AUs; the decode thread drains them. When the decoder falls
    // behind the live stream, stale queued frames are dropped so the
    // presentation stays at the live edge instead of accumulating latency
    // or replaying an old backlog (which manifests as visible "delay" and
    // a periodic "jump back" of the picture).
    std::deque<std::vector<uint8_t>> pending_au_queue_;
    std::mutex au_mutex_;
    std::condition_variable au_cv_;

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
