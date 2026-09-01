#include "../include/input_rtp_receiver.h"
#include "../include/utils.h"
#include <iostream>
#include <cstring>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

namespace GridSight {

static uint16_t ReadBE16(const uint8_t* p) {
    return (static_cast<uint16_t>(p[0]) << 8) | static_cast<uint16_t>(p[1]);
}

static uint32_t ReadBE32(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) |
           (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8)  |
           static_cast<uint32_t>(p[3]);
}

static uint64_t ReadBE64(const uint8_t* p) {
    return (static_cast<uint64_t>(p[0]) << 56) |
           (static_cast<uint64_t>(p[1]) << 48) |
           (static_cast<uint64_t>(p[2]) << 40) |
           (static_cast<uint64_t>(p[3]) << 32) |
           (static_cast<uint64_t>(p[4]) << 24) |
           (static_cast<uint64_t>(p[5]) << 16) |
           (static_cast<uint64_t>(p[6]) << 8)  |
           static_cast<uint64_t>(p[7]);
}

InputRTPReceiver::InputRTPReceiver(const std::string& multicast_ip, int port)
    : multicast_ip_(multicast_ip), port_(port) {}

InputRTPReceiver::~InputRTPReceiver() {
    Stop();
}

bool InputRTPReceiver::ParseInputRTPPacket(const uint8_t* data, size_t size, InputRTPEvent& out_event) {
    out_event = {};
    if (!data || size < 12 + 21) {
        return false;
    }

    // RTP Header (12 bytes)
    const uint8_t version = (data[0] >> 6) & 0x03;
    if (version != 2) return false;

    const bool padding = (data[0] & 0x20) != 0;
    const bool extension = (data[0] & 0x10) != 0;
    const uint8_t csrc_count = data[0] & 0x0F;

    size_t header_len = 12 + static_cast<size_t>(csrc_count) * 4;
    if (header_len > size) return false;

    if (extension) {
        if (header_len + 4 > size) return false;
        uint16_t ext_words = ReadBE16(data + header_len + 2);
        size_t ext_bytes = static_cast<size_t>(ext_words) * 4;
        if (header_len + 4 + ext_bytes > size) return false;
        header_len += 4 + ext_bytes;
    }

    size_t payload_end = size;
    if (padding) {
        if (size == 0) return false;
        uint8_t pad_len = data[size - 1];
        if (pad_len == 0 || pad_len > size - header_len) return false;
        payload_end -= pad_len;
    }

    if (payload_end < header_len + 21) return false;

    out_event.sequence = ReadBE16(data + 2);
    out_event.rtp_timestamp = ReadBE32(data + 4);
    out_event.ssrc = ReadBE32(data + 8);

    const uint8_t* payload = data + header_len;
    out_event.event_type = static_cast<InputEventType>(payload[0]);
    out_event.norm_x = ReadBE16(payload + 1);
    out_event.norm_y = ReadBE16(payload + 3);
    out_event.button_flags = payload[5];
    out_event.scroll_delta = static_cast<int16_t>(ReadBE16(payload + 6));
    out_event.modifier_flags = payload[8];
    out_event.key_code = ReadBE32(payload + 9);
    out_event.timestamp_ms = ReadBE64(payload + 13);

    return true;
}

bool InputRTPReceiver::Start() {
    if (running_.exchange(true)) return socket_fd_.load() != 0;

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) {
        Utils::Log("ERROR", "InputRTPReceiver failed to create UDP socket");
        running_ = false;
        return false;
    }

    int reuse = 1;
#ifdef _WIN32
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    DWORD timeout = 500;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    struct timeval tv = {0, 500000};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
#endif

    sockaddr_in local_addr;
    memset(&local_addr, 0, sizeof(local_addr));
    local_addr.sin_family = AF_INET;
    local_addr.sin_addr.s_addr = INADDR_ANY;
    local_addr.sin_port = htons(port_);

    if (bind(sock, (sockaddr*)&local_addr, sizeof(local_addr)) == SOCKET_ERROR) {
        Utils::Log("ERROR", "InputRTPReceiver bind failed on port " + std::to_string(port_));
        closesocket(sock);
        running_ = false;
        return false;
    }

    in_addr multicast_addr;
    if (inet_pton(AF_INET, multicast_ip_.c_str(), &multicast_addr) != 1) {
        Utils::Log("ERROR", "InputRTPReceiver invalid multicast IPv4: " + multicast_ip_);
        closesocket(sock);
        running_ = false;
        return false;
    }

    bool joined = false;
    NetworkInfo net_info = Utils::GetSystemNetworkInfo();
    in_addr interface_addr;
    if (!net_info.ip.empty() && net_info.ip != "127.0.0.1" &&
        inet_pton(AF_INET, net_info.ip.c_str(), &interface_addr) == 1) {
        struct ip_mreq nic_membership;
        memset(&nic_membership, 0, sizeof(nic_membership));
        nic_membership.imr_multiaddr = multicast_addr;
        nic_membership.imr_interface = interface_addr;
        joined = setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP, (char*)&nic_membership, sizeof(nic_membership)) != SOCKET_ERROR;
    }
    if (!joined) {
        struct ip_mreq any_membership;
        memset(&any_membership, 0, sizeof(any_membership));
        any_membership.imr_multiaddr = multicast_addr;
        any_membership.imr_interface.s_addr = INADDR_ANY;
        joined = setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP, (char*)&any_membership, sizeof(any_membership)) != SOCKET_ERROR;
    }

    if (!joined) {
        Utils::Log("ERROR", "InputRTPReceiver failed to join IGMP multicast group " + multicast_ip_);
        closesocket(sock);
        running_ = false;
        return false;
    }

    socket_fd_.store((uintptr_t)sock);
    try {
        receive_thread_ = std::thread(&InputRTPReceiver::ReceiveLoop, this);
    } catch (const std::exception& err) {
        closesocket(sock);
        socket_fd_.store(0);
        running_ = false;
        Utils::Log("ERROR", "InputRTPReceiver thread start failed: " + std::string(err.what()));
        return false;
    }

    Utils::Log("INFO", "InputRTPReceiver listening on " + multicast_ip_ + ":" + std::to_string(port_));
    return true;
}

void InputRTPReceiver::Stop() {
    if (!running_.exchange(false)) return;

    uintptr_t owned_socket = socket_fd_.exchange(0);
    if (owned_socket != 0 && (SOCKET)owned_socket != INVALID_SOCKET) {
        closesocket((SOCKET)owned_socket);
    }

    if (receive_thread_.joinable()) {
        receive_thread_.join();
    }
}

void InputRTPReceiver::ReceiveLoop() {
    SOCKET sock = (SOCKET)socket_fd_.load();
    if (sock == INVALID_SOCKET || sock == 0) return;

    std::vector<uint8_t> buffer(2048);
    uint64_t packet_count = 0;

    while (running_) {
        sockaddr_in from_addr;
        socklen_t from_len = sizeof(from_addr);
        int bytes = recvfrom(sock, (char*)buffer.data(), (int)buffer.size(), 0, (sockaddr*)&from_addr, &from_len);

        if (bytes > 0) {
            InputRTPEvent event;
            if (ParseInputRTPPacket(buffer.data(), static_cast<size_t>(bytes), event)) {
                packet_count++;
                if (packet_count <= 10 || packet_count % 100 == 0) {
                    Utils::Log("INFO", "🖱️ [Input RTP] Received event #" + std::to_string(packet_count) +
                        ": type=" + std::to_string(static_cast<int>(event.event_type)) +
                        " pos=(" + std::to_string(event.norm_x) + "," + std::to_string(event.norm_y) + ")" +
                        " btn=0x" + std::to_string(event.button_flags) +
                        " scroll=" + std::to_string(event.scroll_delta) +
                        " mod=0x" + std::to_string(event.modifier_flags) +
                        " key=" + std::to_string(event.key_code) +
                        " seq=" + std::to_string(event.sequence));
                }
            }
        }
    }
}

} // namespace GridSight
