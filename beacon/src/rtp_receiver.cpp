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
static void ToggleFullscreen(HWND hwnd) {
    LONG style = GetWindowLongA(hwnd, GWL_STYLE);
    if (style & WS_OVERLAPPEDWINDOW) {
        // Switch to Fullscreen mode
        MONITORINFO mi = { sizeof(mi) };
        if (GetMonitorInfoA(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &mi)) {
            SetWindowLongA(hwnd, GWL_STYLE, WS_POPUP | WS_VISIBLE);
            SetWindowPos(hwnd, HWND_TOPMOST,
                         mi.rcMonitor.left, mi.rcMonitor.top,
                         mi.rcMonitor.right - mi.rcMonitor.left,
                         mi.rcMonitor.bottom - mi.rcMonitor.top,
                         SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
        }
    } else {
        // Switch to Windowed mode
        SetWindowLongA(hwnd, GWL_STYLE, WS_OVERLAPPEDWINDOW | WS_VISIBLE);
        int screen_w = GetSystemMetrics(SM_CXSCREEN);
        int screen_h = GetSystemMetrics(SM_CYSCREEN);
        int win_w = 1280;
        int win_h = 720;
        int x = (screen_w - win_w) / 2;
        int y = (screen_h - win_h) / 2;
        SetWindowPos(hwnd, HWND_NOTOPMOST, x, y, win_w, win_h, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
}

static LRESULT CALLBACK OverlayWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_LBUTTONDBLCLK:
        ToggleFullscreen(hwnd);
        return 0;

    case WM_KEYDOWN:
        if (wParam == 'F' || wParam == 'f' || wParam == VK_F11) {
            ToggleFullscreen(hwnd);
            return 0;
        } else if (wParam == VK_ESCAPE) {
            LONG style = GetWindowLongA(hwnd, GWL_STYLE);
            if (!(style & WS_OVERLAPPEDWINDOW)) {
                ToggleFullscreen(hwnd);
            }
            return 0;
        }
        break;

    case WM_SIZE:
        InvalidateRect(hwnd, NULL, FALSE);
        return 0;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);

        HBRUSH bgBrush = CreateSolidBrush(RGB(15, 23, 42)); // Slate-900 background
        FillRect(hdc, &rc, bgBrush);
        DeleteObject(bgBrush);

        int client_w = rc.right - rc.left;
        int client_h = rc.bottom - rc.top;
        if (client_w > 0 && client_h > 0) {
            double target_aspect = 16.0 / 9.0;
            double client_aspect = (double)client_w / (double)client_h;

            int view_w, view_h, view_x, view_y;
            if (client_aspect > target_aspect) {
                // Pillarbox (black bars on left and right)
                view_h = client_h;
                view_w = (int)(client_h * target_aspect);
                view_x = (client_w - view_w) / 2;
                view_y = 0;
            } else {
                // Letterbox (black bars on top and bottom)
                view_w = client_w;
                view_h = (int)(client_w / target_aspect);
                view_x = 0;
                view_y = (client_h - view_h) / 2;
            }

            // Draw inner presentation area maintaining original 16:9 aspect ratio
            RECT view_rc = { view_x, view_y, view_x + view_w, view_y + view_h };
            HBRUSH viewBrush = CreateSolidBrush(RGB(30, 41, 59));
            FillRect(hdc, &view_rc, viewBrush);
            DeleteObject(viewBrush);

            HPEN hPen = CreatePen(PS_SOLID, 2, RGB(56, 189, 248));
            HPEN hOldPen = (HPEN)SelectObject(hdc, hPen);
            HBRUSH hOldBrush = (HBRUSH)SelectObject(hdc, GetStockObject(HOLLOW_BRUSH));
            Rectangle(hdc, view_x, view_y, view_x + view_w, view_y + view_h);
            SelectObject(hdc, hOldBrush);
            SelectObject(hdc, hOldPen);
            DeleteObject(hPen);

            SetBkMode(hdc, TRANSPARENT);
            SetTextColor(hdc, RGB(56, 189, 248)); // Sky blue
            HFONT hFont = CreateFontA(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                      DEFAULT_PITCH | FF_SWISS, "Segoe UI");
            HFONT hOldFont = (HFONT)SelectObject(hdc, hFont);

            const char* title = "GridSight 教師畫面實時全體廣播中 (H.264 UDP Multicast)";
            DrawTextA(hdc, title, -1, &view_rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

            SetTextColor(hdc, RGB(148, 163, 184)); // Slate-400
            HFONT hSubFont = CreateFontA(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                         OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                         DEFAULT_PITCH | FF_SWISS, "Segoe UI");
            SelectObject(hdc, hSubFont);

            RECT hint_rc = view_rc;
            hint_rc.top = hint_rc.bottom - 40;
            const char* hint = "提示：雙擊畫面或按 [F] / [F11] 可切換全螢幕與視窗模式 (ESC 退出全螢幕)";
            DrawTextA(hdc, hint, -1, &hint_rc, DT_CENTER | DT_SINGLELINE);

            SelectObject(hdc, hOldFont);
            DeleteObject(hFont);
            DeleteObject(hSubFont);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}
#endif

void RTPReceiver::CreateFullScreenOverlayWindow() {
    if (overlay_active_.exchange(true)) return;
    Utils::Log("INFO", "Broadcast received! Activating presentation popup window.");

#ifdef _WIN32
    HINSTANCE hInstance = GetModuleHandle(NULL);
    WNDCLASSA wc = {0};
    wc.style = CS_DBLCLKS; // Enable double-click messages
    wc.lpfnWndProc = OverlayWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = "GridSightOverlayClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassA(&wc);

    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);
    int win_w = 1280;
    int win_h = 720;
    int x = (screen_w - win_w) / 2;
    int y = (screen_h - win_h) / 2;

    HWND hwnd = CreateWindowExA(
        WS_EX_TOPMOST,
        "GridSightOverlayClass",
        "GridSight 教師廣播畫面 (雙擊或按 F 切換全螢幕)",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        x, y, win_w, win_h,
        NULL, NULL, hInstance, NULL
    );

    if (hwnd) {
        hwnd_overlay_ = (void*)hwnd;
        ShowWindow(hwnd, SW_SHOW);
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
