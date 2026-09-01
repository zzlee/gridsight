#pragma once

#include <string>
#include <thread>
#include <atomic>
#include <cstdint>

namespace GridSight {

enum class InputEventType : uint8_t {
    MouseMove = 1,
    MouseDown = 2,
    MouseUp = 3,
    Scroll = 4,
    KeyState = 5
};

struct InputRTPEvent {
    InputEventType event_type;
    uint16_t norm_x;
    uint16_t norm_y;
    uint8_t button_flags;
    int16_t scroll_delta;
    uint8_t modifier_flags;
    uint32_t key_code;
    uint64_t timestamp_ms;
    uint16_t sequence;
    uint32_t rtp_timestamp;
    uint32_t ssrc;
};

class InputRTPReceiver {
public:
    InputRTPReceiver(const std::string& multicast_ip = "239.255.42.100", int port = 9002);
    ~InputRTPReceiver();

    bool Start();
    void Stop();
    bool IsRunning() const { return running_.load(); }

    static bool ParseInputRTPPacket(const uint8_t* data, size_t size, InputRTPEvent& out_event);

private:
    void ReceiveLoop();

    std::string multicast_ip_;
    int port_;
    std::atomic<bool> running_{false};
    std::atomic<uintptr_t> socket_fd_{0};
    std::thread receive_thread_;
};

} // namespace GridSight
