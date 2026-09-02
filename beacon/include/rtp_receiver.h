#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <thread>
#include <string>
#include <vector>

#include "input_rtp_receiver.h"

namespace GridSight {

class RTPReceiver {
public:
    RTPReceiver(const std::string& multicast_ip = "239.255.42.100", int port = 9000);
    ~RTPReceiver();

    bool Start();
    void Stop();
    static void RequestCloseOverlay();

    void UpdateInputEvent(const InputRTPEvent& event);
    void RenderMouseOverlay(void* hdc, int view_x, int view_y, int view_w, int view_h);
    bool AdvanceAnimations();
    bool HasActiveAnimations();

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
    std::atomic<uint64_t> last_stop_broadcast_time_{0};
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

    // Input RTP Cursor and Click Effect Overlay State
    struct ClickAnimation {
        uint16_t norm_x = 0;
        uint16_t norm_y = 0;
        float radius = 6.0f;
        float max_radius = 32.0f;
        float alpha = 240.0f;
        uint8_t type = 0; // 0: Left, 1: Right, 2: Middle
    };

    struct ScrollAnimation {
        uint16_t norm_x = 0;
        uint16_t norm_y = 0;
        float offset_y = 0.0f;
        float alpha = 230.0f;
        bool is_up = true;
    };

    std::mutex input_mutex_;
    bool has_cursor_ = false;
    uint16_t cursor_norm_x_ = 0;
    uint16_t cursor_norm_y_ = 0;
    uint8_t cursor_button_flags_ = 0;
    uint8_t cursor_modifier_flags_ = 0;
    std::vector<ClickAnimation> click_animations_;
    std::vector<ScrollAnimation> scroll_animations_;
    uint64_t last_cursor_event_time_ = 0;
};

} // namespace GridSight
