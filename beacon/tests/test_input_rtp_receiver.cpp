#include <iostream>
#include <cassert>
#include <vector>
#include <cstring>
#include <fstream>
#include "../include/input_rtp_receiver.h"
#include "../include/utils.h"

int main() {
    std::cout << "Running InputRTPReceiver Unit Tests..." << std::endl;

    // Test 1: Binary parsing of a valid 33-byte packet
    std::vector<uint8_t> packet(33, 0);

    // RTP Header (12 bytes)
    packet[0] = 0x80; // V=2, P=0, X=0, CC=0
    packet[1] = 0x62; // M=0, PT=98
    packet[2] = 0x00; // Seq 42
    packet[3] = 0x2A;
    packet[4] = 0x00; // TS 90000
    packet[5] = 0x01;
    packet[6] = 0x5F;
    packet[7] = 0x90;
    packet[8] = 0x12; // SSRC 0x12345678
    packet[9] = 0x34;
    packet[10] = 0x56;
    packet[11] = 0x78;

    // Payload (21 bytes starting at offset 12)
    packet[12] = 2;    // event_type: MouseDown
    packet[13] = 0x7F; // norm_x: 32767
    packet[14] = 0xFF;
    packet[15] = 0x3F; // norm_y: 16383
    packet[16] = 0xFF;
    packet[17] = 0x01; // button_flags: 1 (Left)
    packet[18] = 0x00; // scroll_delta: 120
    packet[19] = 0x78;
    packet[20] = 0x02; // modifier_flags: 2 (Shift)
    packet[21] = 0x00; // key_code: 65
    packet[22] = 0x00;
    packet[23] = 0x00;
    packet[24] = 0x41;
    // timestamp_ms: 1700000000000 (0x0000018bcfe56800)
    packet[25] = 0x00;
    packet[26] = 0x00;
    packet[27] = 0x01;
    packet[28] = 0x8B;
    packet[29] = 0xCF;
    packet[30] = 0xE5;
    packet[31] = 0x68;
    packet[32] = 0x00;

    GridSight::InputRTPEvent event;
    bool ok = GridSight::InputRTPReceiver::ParseInputRTPPacket(packet.data(), packet.size(), event);
    assert(ok && "ParseInputRTPPacket should succeed for valid 33-byte packet");
    assert(event.sequence == 42 && "Sequence should match");
    assert(event.rtp_timestamp == 90000 && "RTP timestamp should match");
    assert(event.ssrc == 0x12345678 && "SSRC should match");
    assert(event.event_type == GridSight::InputEventType::MouseDown && "Event type should match");
    assert(event.norm_x == 32767 && "norm_x should match");
    assert(event.norm_y == 16383 && "norm_y should match");
    assert(event.button_flags == 0x01 && "button_flags should match");
    assert(event.scroll_delta == 120 && "scroll_delta should match");
    assert(event.modifier_flags == 0x02 && "modifier_flags should match");
    assert(event.key_code == 65 && "key_code should match");
    assert(event.timestamp_ms == 1700000000000ULL && "timestamp_ms should match");
    std::cout << "✅ Test 1 passed: ParseInputRTPPacket parses 33-byte packet accurately." << std::endl;

    // Test 2: Reject invalid/malformed packets
    GridSight::InputRTPEvent bad_event;
    assert(!GridSight::InputRTPReceiver::ParseInputRTPPacket(nullptr, 33, bad_event) && "Should reject null data");
    assert(!GridSight::InputRTPReceiver::ParseInputRTPPacket(packet.data(), 32, bad_event) && "Should reject packets < 33 bytes");
    packet[0] = 0x00; // Bad version != 2
    assert(!GridSight::InputRTPReceiver::ParseInputRTPPacket(packet.data(), 33, bad_event) && "Should reject RTP V != 2");
    packet[0] = 0x80;
    std::cout << "✅ Test 2 passed: ParseInputRTPPacket correctly rejects malformed packets." << std::endl;

    // Test 3: InputRTPReceiver instance lifecycle & event listener registration
    GridSight::InputRTPReceiver receiver("239.255.42.100", 19002);
    assert(!receiver.IsRunning() && "Should not be running before Start");
    bool listener_registered = false;
    receiver.SetEventListener([&listener_registered](const GridSight::InputRTPEvent&) {
        listener_registered = true;
    });
    std::cout << "✅ Test 3 passed: Receiver lifecycle and event listener registration verified." << std::endl;

    // Test 4: Logging verification for received event
    GridSight::Utils::Log("INFO", "🖱️ [Input RTP Log] Event #1: type=2 pos=(32767,16383) btn=0x1 scroll=120 mod=0x2 key=65 seq=42 ts=1700000000000");

    std::ifstream log_file("gs-agent.log");
    assert(log_file.is_open() && "gs-agent.log must exist");
    std::string contents((std::istreambuf_iterator<char>(log_file)), std::istreambuf_iterator<char>());
    assert(contents.find("🖱️ [Input RTP Log]") != std::string::npos && "Log file must contain Input RTP log message");
    std::cout << "✅ Test 3 passed: Log verification confirmed in gs-agent.log." << std::endl;

    std::cout << "\n🎉 All InputRTPReceiver tests passed successfully!" << std::endl;
    return 0;
}
