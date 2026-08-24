#include "../include/rtp_receiver.h"
#include "../include/utils.h"
#include <iostream>
#include <vector>
#include <cstring>
#include <chrono>
#include <mutex>
#include <algorithm>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <wmcodecdsp.h>

#ifndef CLSID_CMSH264DecoderMFT
DEFINE_GUID(CLSID_CMSH264DecoderMFT, 0x62ce7e72, 0x4c71, 0x4d20, 0xb1, 0x5d, 0x45, 0x28, 0x31, 0xa8, 0x7d, 0x9d);
#endif

namespace GridSight {

// Global shared frame buffer for presentation overlay
static std::mutex g_frame_mutex;
static std::vector<uint8_t> g_bgra_buffer;
static int g_frame_w = 0;
static int g_frame_h = 0;

class H264DecoderMFT {
public:
    H264DecoderMFT() {
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
        InitDecoder();
    }

    ~H264DecoderMFT() {
        Cleanup();
        MFShutdown();
    }

    bool InitDecoder() {
        Cleanup();
        HRESULT hr = CoCreateInstance(CLSID_CMSH264DecoderMFT, NULL, CLSCTX_INPROC_SERVER, IID_IMFTransform, (void**)&pDecoder_);
        if (FAILED(hr) || !pDecoder_) {
            Utils::Log("ERROR", "Failed to create CMSH264DecoderMFT: hr=" + std::to_string(hr));
            return false;
        }

        IMFMediaType* pInputType = nullptr;
        hr = MFCreateMediaType(&pInputType);
        if (SUCCEEDED(hr)) {
            pInputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
            pInputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
            hr = pDecoder_->SetInputType(0, pInputType, 0);
            pInputType->Release();
        }

        if (FAILED(hr)) {
            Utils::Log("ERROR", "Failed to set H264 input type: hr=" + std::to_string(hr));
            return false;
        }

        pDecoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        pDecoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        initialized_ = true;
        return true;
    }

    void Cleanup() {
        if (pDecoder_) {
            pDecoder_->Release();
            pDecoder_ = nullptr;
        }
        initialized_ = false;
    }

    bool DecodeFrame(const uint8_t* data, size_t size, std::vector<uint8_t>& out_bgra, int& out_w, int& out_h) {
        if (!initialized_ && !InitDecoder()) return false;
        if (!data || size == 0) return false;

        IMFMediaBuffer* pBuffer = nullptr;
        HRESULT hr = MFCreateMemoryBuffer((DWORD)size, &pBuffer);
        if (FAILED(hr)) return false;

        BYTE* pData = nullptr;
        hr = pBuffer->Lock(&pData, NULL, NULL);
        if (SUCCEEDED(hr)) {
            memcpy(pData, data, size);
            pBuffer->Unlock();
            pBuffer->SetCurrentLength((DWORD)size);
        }

        IMFSample* pSample = nullptr;
        hr = MFCreateSample(&pSample);
        if (SUCCEEDED(hr)) {
            pSample->AddBuffer(pBuffer);
            pBuffer->Release();
        } else {
            pBuffer->Release();
            return false;
        }

        hr = pDecoder_->ProcessInput(0, pSample, 0);
        pSample->Release();

        // Drain outputs
        MFT_OUTPUT_DATA_BUFFER outputBuffer = {0};
        DWORD status = 0;
        bool got_frame = false;

        while (true) {
            MFT_OUTPUT_STREAM_INFO streamInfo = {0};
            pDecoder_->GetOutputStreamInfo(0, &streamInfo);

            IMFMediaBuffer* pOutMediaBuffer = nullptr;
            IMFSample* pOutSample = nullptr;

            if (!(streamInfo.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES))) {
                MFCreateSample(&pOutSample);
                DWORD bufSize = streamInfo.cbSize ? streamInfo.cbSize : (1920 * 1080 * 4);
                MFCreateMemoryBuffer(bufSize, &pOutMediaBuffer);
                pOutSample->AddBuffer(pOutMediaBuffer);
                pOutMediaBuffer->Release();
                outputBuffer.pSample = pOutSample;
            }

            outputBuffer.dwStreamID = 0;
            hr = pDecoder_->ProcessOutput(0, 1, &outputBuffer, &status);

            if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
                // Negotiate output subtype (prefer NV12 or RGB32)
                IMFMediaType* pAvailableType = nullptr;
                for (DWORD i = 0; SUCCEEDED(pDecoder_->GetOutputAvailableType(0, i, &pAvailableType)); ++i) {
                    GUID subtype = {0};
                    pAvailableType->GetGUID(MF_MT_SUBTYPE, &subtype);
                    if (subtype == MFVideoFormat_NV12 || subtype == MFVideoFormat_RGB32 || subtype == MFVideoFormat_YV12) {
                        pDecoder_->SetOutputType(0, pAvailableType, 0);
                        pAvailableType->Release();
                        break;
                    }
                    pAvailableType->Release();
                }
                if (outputBuffer.pSample) {
                    outputBuffer.pSample->Release();
                    outputBuffer.pSample = nullptr;
                }
                continue;
            }

            if (FAILED(hr)) {
                if (outputBuffer.pSample) outputBuffer.pSample->Release();
                break;
            }

            // Extract decoded frame image
            IMFMediaType* pCurrentType = nullptr;
            if (SUCCEEDED(pDecoder_->GetOutputCurrentType(0, &pCurrentType))) {
                UINT32 w = 0, h = 0;
                MFGetAttributeSize(pCurrentType, MF_MT_FRAME_SIZE, &w, &h);
                GUID subtype = {0};
                pCurrentType->GetGUID(MF_MT_SUBTYPE, &subtype);
                pCurrentType->Release();

                if (w > 0 && h > 0 && outputBuffer.pSample) {
                    IMFMediaBuffer* pDecBuffer = nullptr;
                    if (SUCCEEDED(outputBuffer.pSample->ConvertToContiguousBuffer(&pDecBuffer))) {
                        BYTE* pRaw = nullptr;
                        DWORD maxLen = 0, curLen = 0;
                        if (SUCCEEDED(pDecBuffer->Lock(&pRaw, &maxLen, &curLen))) {
                            out_w = (int)w;
                            out_h = (int)h;
                            out_bgra.resize((size_t)w * h * 4);

                            if (subtype == MFVideoFormat_NV12) {
                                ConvertNV12ToBGRA(pRaw, w, h, out_bgra.data());
                                got_frame = true;
                            } else if (subtype == MFVideoFormat_RGB32) {
                                memcpy(out_bgra.data(), pRaw, (size_t)w * h * 4);
                                got_frame = true;
                            } else if (subtype == MFVideoFormat_YV12) {
                                ConvertYV12ToBGRA(pRaw, w, h, out_bgra.data());
                                got_frame = true;
                            }

                            pDecBuffer->Unlock();
                        }
                        pDecBuffer->Release();
                    }
                }
            }

            if (outputBuffer.pSample) {
                outputBuffer.pSample->Release();
                outputBuffer.pSample = nullptr;
            }

            if (got_frame) return true;
        }

        return got_frame;
    }

private:
    IMFTransform* pDecoder_ = nullptr;
    bool initialized_ = false;

    static void ConvertNV12ToBGRA(const uint8_t* nv12, int width, int height, uint8_t* bgra) {
        size_t y_size = (size_t)width * height;
        const uint8_t* y_plane = nv12;
        const uint8_t* uv_plane = nv12 + y_size;

        for (int j = 0; j < height; ++j) {
            const uint8_t* y_ptr = y_plane + j * width;
            const uint8_t* uv_ptr = uv_plane + (j / 2) * width;
            uint8_t* dst = bgra + j * width * 4;

            for (int i = 0; i < width; ++i) {
                int y = y_ptr[i];
                int u = uv_ptr[(i / 2) * 2] - 128;
                int v = uv_ptr[(i / 2) * 2 + 1] - 128;

                int c = y - 16;
                if (c < 0) c = 0;

                int r = (298 * c + 409 * v + 128) >> 8;
                int g = (298 * c - 100 * u - 208 * v + 128) >> 8;
                int b = (298 * c + 516 * u + 128) >> 8;

                dst[i * 4 + 0] = (uint8_t)(b < 0 ? 0 : (b > 255 ? 255 : b));
                dst[i * 4 + 1] = (uint8_t)(g < 0 ? 0 : (g > 255 ? 255 : g));
                dst[i * 4 + 2] = (uint8_t)(r < 0 ? 0 : (r > 255 ? 255 : r));
                dst[i * 4 + 3] = 255;
            }
        }
    }

    static void ConvertYV12ToBGRA(const uint8_t* yv12, int width, int height, uint8_t* bgra) {
        size_t y_size = (size_t)width * height;
        size_t uv_size = (size_t)(width / 2) * (height / 2);
        const uint8_t* y_plane = yv12;
        const uint8_t* v_plane = yv12 + y_size;
        const uint8_t* u_plane = v_plane + uv_size;

        for (int j = 0; j < height; ++j) {
            const uint8_t* y_ptr = y_plane + j * width;
            const uint8_t* u_ptr = u_plane + (j / 2) * (width / 2);
            const uint8_t* v_ptr = v_plane + (j / 2) * (width / 2);
            uint8_t* dst = bgra + j * width * 4;

            for (int i = 0; i < width; ++i) {
                int y = y_ptr[i];
                int u = u_ptr[i / 2] - 128;
                int v = v_ptr[i / 2] - 128;

                int c = y - 16;
                if (c < 0) c = 0;

                int r = (298 * c + 409 * v + 128) >> 8;
                int g = (298 * c - 100 * u - 208 * v + 128) >> 8;
                int b = (298 * c + 516 * u + 128) >> 8;

                dst[i * 4 + 0] = (uint8_t)(b < 0 ? 0 : (b > 255 ? 255 : b));
                dst[i * 4 + 1] = (uint8_t)(g < 0 ? 0 : (g > 255 ? 255 : g));
                dst[i * 4 + 2] = (uint8_t)(r < 0 ? 0 : (r > 255 ? 255 : r));
                dst[i * 4 + 3] = 255;
            }
        }
    }
};

static void ToggleFullscreen(HWND hwnd) {
    LONG style = GetWindowLongA(hwnd, GWL_STYLE);
    if (style & WS_OVERLAPPEDWINDOW) {
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
    case WM_ERASEBKGND:
        return 1; // Prevent flicker

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

        int client_w = rc.right - rc.left;
        int client_h = rc.bottom - rc.top;
        if (client_w <= 0 || client_h <= 0) {
            EndPaint(hwnd, &ps);
            return 0;
        }

        // Double buffer
        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, client_w, client_h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        HBRUSH bgBrush = CreateSolidBrush(RGB(15, 23, 42)); // Slate-900
        FillRect(memDC, &rc, bgBrush);
        DeleteObject(bgBrush);

        bool has_frame = false;
        std::vector<uint8_t> frame_copy;
        int fw = 0, fh = 0;

        {
            std::lock_guard<std::mutex> lock(g_frame_mutex);
            if (g_frame_w > 0 && g_frame_h > 0 && !g_bgra_buffer.empty()) {
                has_frame = true;
                fw = g_frame_w;
                fh = g_frame_h;
                frame_copy = g_bgra_buffer;
            }
        }

        if (has_frame) {
            double target_aspect = (double)fw / (double)fh;
            double client_aspect = (double)client_w / (double)client_h;

            int view_w, view_h, view_x, view_y;
            if (client_aspect > target_aspect) {
                view_h = client_h;
                view_w = (int)(client_h * target_aspect);
                view_x = (client_w - view_w) / 2;
                view_y = 0;
            } else {
                view_w = client_w;
                view_h = (int)(client_w / target_aspect);
                view_x = 0;
                view_y = (client_h - view_h) / 2;
            }

            BITMAPINFO bmi = {0};
            bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            bmi.bmiHeader.biWidth = fw;
            bmi.bmiHeader.biHeight = -fh; // Top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            SetStretchBltMode(memDC, COLORONCOLOR);
            StretchDIBits(memDC, view_x, view_y, view_w, view_h, 0, 0, fw, fh, frame_copy.data(), &bmi, DIB_RGB_COLORS, SRCCOPY);
        } else {
            // Draw initial placeholder while waiting for first I-frame
            int view_w, view_h, view_x, view_y;
            double target_aspect = 16.0 / 9.0;
            double client_aspect = (double)client_w / (double)client_h;

            if (client_aspect > target_aspect) {
                view_h = client_h;
                view_w = (int)(client_h * target_aspect);
                view_x = (client_w - view_w) / 2;
                view_y = 0;
            } else {
                view_w = client_w;
                view_h = (int)(client_w / target_aspect);
                view_x = 0;
                view_y = (client_h - view_h) / 2;
            }

            RECT view_rc = { view_x, view_y, view_x + view_w, view_y + view_h };
            HBRUSH viewBrush = CreateSolidBrush(RGB(30, 41, 59));
            FillRect(memDC, &view_rc, viewBrush);
            DeleteObject(viewBrush);

            HPEN hPen = CreatePen(PS_SOLID, 2, RGB(56, 189, 248));
            HPEN hOldPen = (HPEN)SelectObject(memDC, hPen);
            HBRUSH hOldBrush = (HBRUSH)SelectObject(memDC, GetStockObject(HOLLOW_BRUSH));
            Rectangle(memDC, view_x, view_y, view_x + view_w, view_y + view_h);
            SelectObject(memDC, hOldBrush);
            SelectObject(memDC, hOldPen);
            DeleteObject(hPen);

            SetBkMode(memDC, TRANSPARENT);
            SetTextColor(memDC, RGB(56, 189, 248));
            HFONT hFont = CreateFontW(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                      DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
            if (!hFont) {
                hFont = CreateFontW(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                    OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                    DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
            }
            HFONT hOldFont = (HFONT)SelectObject(memDC, hFont);

            const wchar_t* title = L"GridSight 教師畫面實時全體廣播中 (H.264 UDP Multicast)";
            DrawTextW(memDC, title, -1, &view_rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);

            SetTextColor(memDC, RGB(148, 163, 184));
            HFONT hSubFont = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                         OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                         DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
            if (!hSubFont) {
                hSubFont = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
            }
            SelectObject(memDC, hSubFont);

            RECT hint_rc = view_rc;
            hint_rc.top = hint_rc.bottom - 40;
            const wchar_t* hint = L"提示：雙擊畫面或按 [F] / [F11] 可切換全螢幕與視窗模式 (ESC 退出全螢幕)";
            DrawTextW(memDC, hint, -1, &hint_rc, DT_CENTER | DT_SINGLELINE);

            SelectObject(memDC, hOldFont);
            DeleteObject(hFont);
            DeleteObject(hSubFont);
        }

        BitBlt(hdc, 0, 0, client_w, client_h, memDC, 0, 0, SRCCOPY);

        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

} // namespace GridSight
#else
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
#ifdef _WIN32
    if (decoder_) {
        delete (H264DecoderMFT*)decoder_;
        decoder_ = nullptr;
    }
#endif
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
            last_packet_time = now;
            if (!overlay_active_) {
                CreateFullScreenOverlayWindow();
            }

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
            // Close overlay if no packets received for > 3.5s
            if (overlay_active_ && (now - last_packet_time > 3500)) {
                CloseOverlayWindow();
            }
        }
    }

    closesocket(sock);
    CloseOverlayWindow();
}

void RTPReceiver::CreateFullScreenOverlayWindow() {
    if (overlay_active_.exchange(true)) return;
    Utils::Log("INFO", "Broadcast received! Activating presentation popup window.");

#ifdef _WIN32
    if (ui_thread_.joinable()) {
        ui_thread_.detach();
    }
    ui_thread_ = std::thread(&RTPReceiver::UIThreadLoop, this);
#endif
}

void RTPReceiver::UIThreadLoop() {
#ifdef _WIN32
    HINSTANCE hInstance = GetModuleHandle(NULL);
    WNDCLASSW wc = {0};
    wc.style = CS_DBLCLKS;
    wc.lpfnWndProc = OverlayWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"GridSightOverlayClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassW(&wc);

    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);
    int win_w = 1280;
    int win_h = 720;
    int x = (screen_w - win_w) / 2;
    int y = (screen_h - win_h) / 2;

    HWND hwnd = CreateWindowExW(
        WS_EX_TOPMOST,
        L"GridSightOverlayClass",
        L"GridSight 教師廣播畫面 (雙擊或按 F 切換全螢幕)",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        x, y, win_w, win_h,
        NULL, NULL, hInstance, NULL
    );

    if (hwnd) {
        hwnd_overlay_ = (void*)hwnd;
        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);

        MSG msg;
        while (overlay_active_ && GetMessageW(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        DestroyWindow(hwnd);
        hwnd_overlay_ = nullptr;
    }
#endif
}

void RTPReceiver::RenderFrame(const uint8_t* h264_data, size_t size) {
#ifdef _WIN32
    if (!decoder_) {
        decoder_ = new H264DecoderMFT();
    }

    std::vector<uint8_t> bgra;
    int w = 0, h = 0;
    H264DecoderMFT* dec = (H264DecoderMFT*)decoder_;
    if (dec && dec->DecodeFrame(h264_data, size, bgra, w, h)) {
        {
            std::lock_guard<std::mutex> lock(g_frame_mutex);
            g_bgra_buffer = std::move(bgra);
            g_frame_w = w;
            g_frame_h = h;
        }
        if (hwnd_overlay_) {
            InvalidateRect((HWND)hwnd_overlay_, NULL, FALSE);
        }
    }
#endif
}

void RTPReceiver::CloseOverlayWindow() {
    if (!overlay_active_.exchange(false)) return;
    Utils::Log("INFO", "Broadcast ended. Dismissing full-screen overlay.");

#ifdef _WIN32
    {
        std::lock_guard<std::mutex> lock(g_frame_mutex);
        g_bgra_buffer.clear();
        g_frame_w = 0;
        g_frame_h = 0;
    }
    if (hwnd_overlay_) {
        PostMessageW((HWND)hwnd_overlay_, WM_CLOSE, 0, 0);
    }
    if (ui_thread_.joinable()) {
        ui_thread_.detach();
    }
#endif
}

} // namespace GridSight
