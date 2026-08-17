#include "../include/rtp_receiver.h"
#include "../include/utils.h"
#include <iostream>
#include <vector>
#include <cstring>
#include <chrono>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
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
    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) {
        Utils::Log("ERROR", "RTPReceiver failed to create UDP socket");
        return;
    }

    int reuse = 1;
#ifdef _WIN32
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    DWORD timeout = 500;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 500000;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
#endif

    sockaddr_in local_addr;
    memset(&local_addr, 0, sizeof(local_addr));
    local_addr.sin_family = AF_INET;
    local_addr.sin_addr.s_addr = INADDR_ANY;
    local_addr.sin_port = htons(port_);

    if (bind(sock, (sockaddr*)&local_addr, sizeof(local_addr)) == SOCKET_ERROR) {
        Utils::Log("ERROR", "RTPReceiver bind failed on port " + std::to_string(port_));
        closesocket(sock);
        return;
    }

    // Join IGMP Multicast group
    struct ip_mreq mreq;
    memset(&mreq, 0, sizeof(mreq));
    mreq.imr_multiaddr.s_addr = inet_addr(multicast_ip_.c_str());
    mreq.imr_interface.s_addr = INADDR_ANY;

    if (setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP, (char*)&mreq, sizeof(mreq)) == SOCKET_ERROR) {
        Utils::Log("WARN", "RTPReceiver IP_ADD_MEMBERSHIP error for group " + multicast_ip_);
    } else {
        Utils::Log("INFO", "RTPReceiver joined IGMP multicast group " + multicast_ip_);
    }

    std::vector<uint8_t> rtp_buffer(65536);
    std::vector<uint8_t> fua_reassembly_buffer;
    uint64_t last_packet_time = 0;

    while (running_) {
        sockaddr_in from_addr;
        socklen_t from_len = sizeof(from_addr);
        int bytes = recvfrom(sock, (char*)rtp_buffer.data(), (int)rtp_buffer.size(), 0, (sockaddr*)&from_addr, &from_len);

        uint64_t now = Utils::GetCurrentTimestampMs();

        if (bytes >= 12) {
            // Valid RTP packet received
            last_packet_time = now;
            if (!overlay_active_) {
                CreateFullScreenOverlayWindow();
            }

            // Extract RTP payload (standard 12-byte header)
            const uint8_t* payload = rtp_buffer.data() + 12;
            int payload_len = bytes - 12;

            if (payload_len > 0) {
                uint8_t nal_unit_type = payload[0] & 0x1F;

                if (nal_unit_type == 28) { // FU-A Fragmented NAL Unit (RFC 6184)
                    if (payload_len >= 2) {
                        uint8_t fu_header = payload[1];
                        bool start_bit = (fu_header & 0x80) != 0;
                        bool end_bit = (fu_header & 0x40) != 0;
                        uint8_t original_nal_type = (payload[0] & 0xE0) | (fu_header & 0x1F);

                        if (start_bit) {
                            fua_reassembly_buffer.clear();
                            // Annex B start code
                            fua_reassembly_buffer.push_back(0x00);
                            fua_reassembly_buffer.push_back(0x00);
                            fua_reassembly_buffer.push_back(0x00);
                            fua_reassembly_buffer.push_back(0x01);
                            fua_reassembly_buffer.push_back(original_nal_type);
                            fua_reassembly_buffer.insert(fua_reassembly_buffer.end(), payload + 2, payload + payload_len);
                        } else if (!fua_reassembly_buffer.empty()) {
                            fua_reassembly_buffer.insert(fua_reassembly_buffer.end(), payload + 2, payload + payload_len);
                            if (end_bit) {
                                RenderFrame(fua_reassembly_buffer.data(), fua_reassembly_buffer.size());
                                fua_reassembly_buffer.clear();
                            }
                        }
                    }
                } else if (nal_unit_type >= 1 && nal_unit_type <= 23) {
                    // Single NAL unit packet
                    std::vector<uint8_t> single_nal;
                    single_nal.push_back(0x00);
                    single_nal.push_back(0x00);
                    single_nal.push_back(0x00);
                    single_nal.push_back(0x01);
                    single_nal.insert(single_nal.end(), payload, payload + payload_len);
                    RenderFrame(single_nal.data(), single_nal.size());
                }
            }
        } else {
            // Check timeout: close overlay if no packets received for > 3.5s
            if (overlay_active_ && (now - last_packet_time > 3500)) {
                CloseOverlayWindow();
            }
        }
    }

    closesocket(sock);
    CloseOverlayWindow();
}

#ifdef _WIN32
static LRESULT CALLBACK OverlayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_PAINT) {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH br = CreateSolidBrush(RGB(15, 23, 42)); // Slate-900 background
        FillRect(hdc, &rc, br);
        DeleteObject(br);

        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, RGB(56, 189, 248)); // Sky blue
        HFONT hFont = CreateFontA(24, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                  OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                  DEFAULT_PITCH | FF_SWISS, "Segoe UI");
        HFONT hOldFont = (HFONT)SelectObject(hdc, hFont);
        const char* title = "GridSight 教師畫面實時全體廣播中 (IGMP Multicast RTP)";
        DrawTextA(hdc, title, -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        SelectObject(hdc, hOldFont);
        DeleteObject(hFont);

        EndPaint(hwnd, &ps);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}
#endif

void RTPReceiver::CreateFullScreenOverlayWindow() {
    if (overlay_active_.exchange(true)) return;
    Utils::Log("INFO", "Broadcast received! Activating full-screen topmost presentation overlay.");

#ifdef _WIN32
    HINSTANCE hInstance = GetModuleHandle(NULL);
    WNDCLASSA wc = {0};
    wc.lpfnWndProc = OverlayWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = "GridSightOverlayClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassA(&wc);

    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);

    HWND hwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        "GridSightOverlayClass",
        "GridSight Broadcast Screen",
        WS_POPUP | WS_VISIBLE,
        0, 0, screen_w, screen_h,
        NULL, NULL, hInstance, NULL
    );

    if (hwnd) {
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, screen_w, screen_h, SWP_SHOWWINDOW);
        hwnd_overlay_ = (void*)hwnd;
        UpdateWindow(hwnd);
    }
#endif
}

void RTPReceiver::RenderFrame(const uint8_t* h264_data, size_t size) {
    // Frame received for rendering pipeline
}

void RTPReceiver::CloseOverlayWindow() {
    if (!overlay_active_.exchange(false)) return;
    Utils::Log("INFO", "Broadcast ended. Dismissing full-screen overlay.");

#ifdef _WIN32
    if (hwnd_overlay_) {
        DestroyWindow((HWND)hwnd_overlay_);
        hwnd_overlay_ = nullptr;
    }
#endif
}

} // namespace GridSight
