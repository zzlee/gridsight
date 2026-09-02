#define UNICODE
#define _UNICODE
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <gdiplus.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <algorithm>
#include <chrono>
#include <thread>
#include <atomic>
#include <io.h>
#include <fcntl.h>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "winmm.lib")

using namespace Gdiplus;

/*
 * GridSight In-Pipeline Screen Capture & Mouse Compositor (GridSightScreenCapture.exe)
 *
 * Captures Windows desktop via DXGI Desktop Duplication (hardware GPU capture)
 * or GDI BitBlt fallback, stamps authentic mouse cursor, click ripples, and
 * scroll indicators in-memory, and writes raw BGR0 video frames to stdout for FFmpeg.
 *
 * ADVANTAGES (Option A / OBS Mode):
 * 1. Zero overlay window on teacher's physical display (100% clean, non-intrusive).
 * 2. Absolute frame-accurate synchronization (0ms delay mismatch between click & video).
 * 3. Native video recording support (mouse effects are baked directly into the video stream).
 * 4. Zero extra processing or secondary rendering needed on student agents.
 */

enum ClickType {
    CLICK_LEFT,
    CLICK_RIGHT,
    CLICK_MIDDLE
};

struct ClickEffect {
    int x;
    int y;
    float radius;
    float max_radius;
    float alpha;
    ClickType type;
};

struct ScrollEffect {
    int x;
    int y;
    float offset_y;
    float alpha;
    bool is_up;
};

struct MoveEffect {
    float radius;
    float max_radius;
    float alpha;
    DWORD start_time;
};

// Global mouse state
static CRITICAL_SECTION g_mouse_cs;
static POINT g_cursor_pos = {0, 0};
static std::vector<ClickEffect> g_click_effects;
static std::vector<ScrollEffect> g_scroll_effects;
static std::vector<MoveEffect> g_move_effects;
static DWORD g_last_move_time = 0;
static std::atomic<bool> g_running(true);
static HHOOK g_mouse_hook = NULL;

LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        MSLLHOOKSTRUCT* hook = (MSLLHOOKSTRUCT*)lParam;
        EnterCriticalSection(&g_mouse_cs);
        if (wParam == WM_MOUSEMOVE) {
            DWORD now = GetTickCount();
            if (g_last_move_time != 0 && (now - g_last_move_time) >= 1000) {
                g_move_effects.clear();
                MoveEffect eff;
                eff.radius = 6.0f;
                eff.max_radius = 26.0f;
                eff.alpha = 255.0f;
                eff.start_time = now;
                g_move_effects.push_back(eff);
            }
            g_last_move_time = now;
            g_cursor_pos = hook->pt;
        } else if (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN || wParam == 0x0207 /* WM_MBUTTONDOWN */) {
            g_cursor_pos = hook->pt;
            ClickType type = (wParam == WM_LBUTTONDOWN) ? CLICK_LEFT :
                             (wParam == WM_RBUTTONDOWN) ? CLICK_RIGHT : CLICK_MIDDLE;
            if (g_click_effects.size() >= 12) {
                g_click_effects.erase(g_click_effects.begin());
            }
            ClickEffect eff;
            eff.x = hook->pt.x;
            eff.y = hook->pt.y;
            eff.radius = (type == CLICK_RIGHT) ? 8.0f : 6.0f;
            eff.max_radius = (type == CLICK_LEFT) ? 36.0f : (type == CLICK_RIGHT) ? 42.0f : 30.0f;
            eff.alpha = 245.0f;
            eff.type = type;
            g_click_effects.push_back(eff);
        } else if (wParam == WM_MOUSEWHEEL) {
            g_cursor_pos = hook->pt;
            short delta = (short)HIWORD(hook->mouseData);
            if (g_scroll_effects.size() >= 8) {
                g_scroll_effects.erase(g_scroll_effects.begin());
            }
            ScrollEffect eff;
            eff.x = hook->pt.x;
            eff.y = hook->pt.y;
            eff.offset_y = 0.0f;
            eff.alpha = 230.0f;
            eff.is_up = (delta > 0);
            g_scroll_effects.push_back(eff);
        }
        LeaveCriticalSection(&g_mouse_cs);
    }
    return CallNextHookEx(g_mouse_hook, nCode, wParam, lParam);
}

void MouseHookThread() {
    g_mouse_hook = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandle(NULL), 0);
    MSG msg;
    while (g_running && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    if (g_mouse_hook) {
        UnhookWindowsHookEx(g_mouse_hook);
        g_mouse_hook = NULL;
    }
}

// DXGI Capture State
struct DxgiCapture {
    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    IDXGIOutputDuplication* dup = nullptr;
    ID3D11Texture2D* staging_tex = nullptr;
    int width = 0;
    int height = 0;
    bool initialized = false;

    bool Init() {
        D3D_FEATURE_LEVEL feature_level;
        HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
                                       nullptr, 0, D3D11_SDK_VERSION, &device, &feature_level, &context);
        if (FAILED(hr)) return false;

        IDXGIDevice* dxgi_device = nullptr;
        hr = device->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgi_device);
        if (FAILED(hr)) { Release(); return false; }

        IDXGIAdapter* adapter = nullptr;
        hr = dxgi_device->GetParent(__uuidof(IDXGIAdapter), (void**)&adapter);
        dxgi_device->Release();
        if (FAILED(hr)) { Release(); return false; }

        IDXGIOutput* output = nullptr;
        hr = adapter->EnumOutputs(0, &output);
        adapter->Release();
        if (FAILED(hr)) { Release(); return false; }

        IDXGIOutput1* output1 = nullptr;
        hr = output->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output1);
        output->Release();
        if (FAILED(hr)) { Release(); return false; }

        hr = output1->DuplicateOutput(device, &dup);
        output1->Release();
        if (FAILED(hr)) { Release(); return false; }

        DXGI_OUTDUPL_DESC desc;
        dup->GetDesc(&desc);
        width = desc.ModeDesc.Width;
        height = desc.ModeDesc.Height;

        D3D11_TEXTURE2D_DESC tex_desc = {0};
        tex_desc.Width = width;
        tex_desc.Height = height;
        tex_desc.MipLevels = 1;
        tex_desc.ArraySize = 1;
        tex_desc.Format = desc.ModeDesc.Format;
        tex_desc.SampleDesc.Count = 1;
        tex_desc.Usage = D3D11_USAGE_STAGING;
        tex_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;

        hr = device->CreateTexture2D(&tex_desc, nullptr, &staging_tex);
        if (FAILED(hr)) { Release(); return false; }

        initialized = true;
        return true;
    }

    bool Capture(uint8_t* dest_buf, int dest_pitch) {
        if (!initialized) return false;

        DXGI_OUTDUPL_FRAME_INFO frame_info;
        IDXGIResource* desktop_res = nullptr;
        HRESULT hr = dup->AcquireNextFrame(20, &frame_info, &desktop_res);

        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            // Desktop unchanged; reuse existing staging texture content
            D3D11_MAPPED_SUBRESOURCE mapped;
            hr = context->Map(staging_tex, 0, D3D11_MAP_READ, 0, &mapped);
            if (SUCCEEDED(hr)) {
                for (int y = 0; y < height; ++y) {
                    memcpy(dest_buf + y * dest_pitch, (uint8_t*)mapped.pData + y * mapped.RowPitch, width * 4);
                }
                context->Unmap(staging_tex, 0);
                return true;
            }
            return false;
        }

        if (FAILED(hr)) {
            // Display mode changed or lost
            Release();
            return false;
        }

        ID3D11Texture2D* desktop_tex = nullptr;
        hr = desktop_res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&desktop_tex);
        desktop_res->Release();

        if (SUCCEEDED(hr)) {
            context->CopyResource(staging_tex, desktop_tex);
            desktop_tex->Release();

            D3D11_MAPPED_SUBRESOURCE mapped;
            hr = context->Map(staging_tex, 0, D3D11_MAP_READ, 0, &mapped);
            if (SUCCEEDED(hr)) {
                for (int y = 0; y < height; ++y) {
                    memcpy(dest_buf + y * dest_pitch, (uint8_t*)mapped.pData + y * mapped.RowPitch, width * 4);
                }
                context->Unmap(staging_tex, 0);
            }
        }
        dup->ReleaseFrame();
        return SUCCEEDED(hr);
    }

    void Release() {
        if (staging_tex) { staging_tex->Release(); staging_tex = nullptr; }
        if (dup) { dup->Release(); dup = nullptr; }
        if (context) { context->Release(); context = nullptr; }
        if (device) { device->Release(); device = nullptr; }
        initialized = false;
    }
};

// GDI Fallback Capture
struct GdiCapture {
    HDC screen_dc = NULL;
    HDC mem_dc = NULL;
    HBITMAP hbm = NULL;
    void* bits = nullptr;
    int width = 0;
    int height = 0;

    bool Init(int w, int h) {
        width = w;
        height = h;
        screen_dc = GetDC(NULL);
        mem_dc = CreateCompatibleDC(screen_dc);

        BITMAPINFO bmi = {0};
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bmi.bmiHeader.biWidth = width;
        bmi.bmiHeader.biHeight = -height; // Top-down
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB;

        hbm = CreateDIBSection(screen_dc, &bmi, DIB_RGB_COLORS, &bits, NULL, 0);
        SelectObject(mem_dc, hbm);
        return (bits != nullptr);
    }

    bool Capture(uint8_t* dest_buf, int dest_pitch) {
        if (!bits || !mem_dc || !screen_dc) return false;
        BitBlt(mem_dc, 0, 0, width, height, screen_dc, 0, 0, SRCCOPY);
        for (int y = 0; y < height; ++y) {
            memcpy(dest_buf + y * dest_pitch, (uint8_t*)bits + y * (width * 4), width * 4);
        }
        return true;
    }

    void Release() {
        if (hbm) { DeleteObject(hbm); hbm = NULL; }
        if (mem_dc) { DeleteDC(mem_dc); mem_dc = NULL; }
        if (screen_dc) { ReleaseDC(NULL, screen_dc); screen_dc = NULL; }
        bits = nullptr;
    }
};

int main(int argc, char* argv[]) {
    // Enable DPI awareness
    SetProcessDPIAware();

    // Set stdout to pure unbuffered binary mode for rawvideo pipe
    _setmode(_fileno(stdout), _O_BINARY);
    HANDLE stdout_handle = GetStdHandle(STD_OUTPUT_HANDLE);

    int target_fps = 30;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--fps") == 0 && i + 1 < argc) {
            target_fps = std::max(10, std::min(60, atoi(argv[++i])));
        }
    }

    InitializeCriticalSection(&g_mouse_cs);

    // Start background mouse hook thread
    std::thread hook_thread(MouseHookThread);
    hook_thread.detach();

    // Initialize GDI+ for in-memory stamping
    GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    // Determine primary screen dimensions
    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);

    DxgiCapture dxgi;
    GdiCapture gdi;
    bool use_dxgi = dxgi.Init();
    if (use_dxgi) {
        screen_w = dxgi.width;
        screen_h = dxgi.height;
    } else {
        gdi.Init(screen_w, screen_h);
    }

    // Allocate frame buffer (32-bit BGR0)
    int pitch = screen_w * 4;
    std::vector<uint8_t> frame_buf((size_t)pitch * screen_h, 0);

    // Notify parent process (Node.js) via stderr of screen dimensions & readiness
    fprintf(stderr, "READY %d %d %d %s\n", screen_w, screen_h, target_fps, use_dxgi ? "DXGI" : "GDI");
    fflush(stderr);

    // High resolution timer
    timeBeginPeriod(1);
    const int frame_time_ms = 1000 / target_fps;

    while (g_running) {
        auto t_start = std::chrono::steady_clock::now();

        // 1. Capture screen into frame buffer
        bool ok = false;
        if (use_dxgi) {
            ok = dxgi.Capture(frame_buf.data(), pitch);
            if (!ok && !dxgi.initialized) {
                // Try to reinitialize DXGI or fallback to GDI
                if (!dxgi.Init()) {
                    use_dxgi = false;
                    gdi.Init(screen_w, screen_h);
                }
            }
        }
        if (!use_dxgi) {
            ok = gdi.Capture(frame_buf.data(), pitch);
        }

        if (ok) {
            // 2. In-memory mouse effect stamping (OBS / Option A pipeline)
            Bitmap bmp(screen_w, screen_h, pitch, PixelFormat32bppRGB, frame_buf.data());
            {
                Graphics g(&bmp);
                g.SetSmoothingMode(SmoothingModeAntiAlias);

                EnterCriticalSection(&g_mouse_cs);
                POINT cur = g_cursor_pos;
                DWORD now = GetTickCount();

                // 2a. Draw Motion Halo / Micro Ripple on cursor after idle
                for (size_t i = 0; i < g_move_effects.size(); ) {
                    auto& eff = g_move_effects[i];
                    DWORD elapsed = now - eff.start_time;
                    float progress = (float)elapsed / 500.0f;
                    if (progress >= 1.0f) {
                        g_move_effects.erase(g_move_effects.begin() + i);
                    } else {
                        eff.radius = 6.0f + (eff.max_radius - 6.0f) * progress;
                        eff.alpha = 255.0f * (1.0f - progress);
                        int a = (int)eff.alpha;
                        Pen movePen(Color(a, 56, 189, 248), 2.2f);
                        SolidBrush moveBrush(Color((int)(a * 0.25f), 56, 189, 248));
                        g.FillEllipse(&moveBrush, (REAL)(cur.x - eff.radius), (REAL)(cur.y - eff.radius), (REAL)(eff.radius * 2.0f), (REAL)(eff.radius * 2.0f));
                        g.DrawEllipse(&movePen, (REAL)(cur.x - eff.radius), (REAL)(cur.y - eff.radius), (REAL)(eff.radius * 2.0f), (REAL)(eff.radius * 2.0f));
                        ++i;
                    }
                }

                // 2b. Draw Click Ripple Animations
                for (size_t i = 0; i < g_click_effects.size(); ) {
                    auto& eff = g_click_effects[i];
                    BYTE a = (BYTE)std::max(0.0f, std::min(255.0f, eff.alpha));

                    if (eff.type == CLICK_LEFT) {
                        // Cyan Expanding Pulse
                        Pen ringPen(Color(a, 0, 229, 255), 3.2f);
                        g.DrawEllipse(&ringPen, (REAL)(eff.x - eff.radius), (REAL)(eff.y - eff.radius), (REAL)(eff.radius * 2.0f), (REAL)(eff.radius * 2.0f));
                        if (eff.radius < 16.0f) {
                            SolidBrush dot(Color(a, 0, 229, 255));
                            g.FillEllipse(&dot, (INT)(eff.x - 3), (INT)(eff.y - 3), 6, 6);
                        }
                    } else if (eff.type == CLICK_RIGHT) {
                        // Amber / Orange Concentric Pulse
                        Pen ring1(Color(a, 255, 152, 0), 3.2f);
                        Pen ring2(Color((BYTE)(a * 0.7f), 255, 87, 34), 2.0f);
                        g.DrawEllipse(&ring1, (REAL)(eff.x - eff.radius), (REAL)(eff.y - eff.radius), (REAL)(eff.radius * 2.0f), (REAL)(eff.radius * 2.0f));
                        float inR = std::max(2.0f, eff.radius - 8.0f);
                        g.DrawEllipse(&ring2, (REAL)(eff.x - inR), (REAL)(eff.y - inR), (REAL)(inR * 2.0f), (REAL)(inR * 2.0f));
                    } else {
                        // Violet Middle Click
                        Pen ring(Color(a, 168, 85, 247), 3.2f);
                        g.DrawEllipse(&ring, (REAL)(eff.x - eff.radius), (REAL)(eff.y - eff.radius), (REAL)(eff.radius * 2.0f), (REAL)(eff.radius * 2.0f));
                    }

                    // Animate
                    eff.radius += (eff.max_radius - eff.radius) * 0.35f + 0.8f;
                    eff.alpha -= 20.0f;

                    if (eff.alpha <= 0.0f || eff.radius >= eff.max_radius) {
                        g_click_effects.erase(g_click_effects.begin() + i);
                    } else {
                        ++i;
                    }
                }

                // 2b. Draw Scroll Wheel Indicators
                for (size_t i = 0; i < g_scroll_effects.size(); ) {
                    auto& eff = g_scroll_effects[i];
                    BYTE a = (BYTE)std::max(0.0f, std::min(255.0f, eff.alpha));
                    int sx = eff.x + 14;
                    int sy = (int)(eff.y + eff.offset_y + 4);

                    SolidBrush bgBrush(Color((BYTE)(a * 0.85f), 15, 23, 42));
                    g.FillEllipse(&bgBrush, sx - 8, sy - 8, 16, 16);
                    Pen borderPen(Color((BYTE)(a * 0.6f), 56, 189, 248), 1.2f);
                    g.DrawEllipse(&borderPen, sx - 8, sy - 8, 16, 16);

                    SolidBrush arrowBrush(Color(a, 56, 189, 248));
                    Point pts[3];
                    if (eff.is_up) {
                        pts[0] = Point(sx, sy - 4);
                        pts[1] = Point(sx - 4, sy + 3);
                        pts[2] = Point(sx + 4, sy + 3);
                    } else {
                        pts[0] = Point(sx, sy + 4);
                        pts[1] = Point(sx - 4, sy - 3);
                        pts[2] = Point(sx + 4, sy - 3);
                    }
                    g.FillPolygon(&arrowBrush, pts, 3);

                    eff.offset_y += eff.is_up ? -2.0f : 2.0f;
                    eff.alpha -= 18.0f;
                    if (eff.alpha <= 0.0f) {
                        g_scroll_effects.erase(g_scroll_effects.begin() + i);
                    } else {
                        ++i;
                    }
                }

                // 2c. Draw Authentic Hardware Mouse Cursor
                CURSORINFO ci = {0};
                ci.cbSize = sizeof(CURSORINFO);
                bool drew_cursor = false;
                if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING) && ci.hCursor) {
                    ICONINFO ii = {0};
                    if (GetIconInfo(ci.hCursor, &ii)) {
                        Bitmap* cursorBmp = Bitmap::FromHICON(ci.hCursor);
                        if (cursorBmp && cursorBmp->GetLastStatus() == Ok) {
                            g.DrawImage(cursorBmp, (INT)(cur.x - (int)ii.xHotspot), (INT)(cur.y - (int)ii.yHotspot));
                            drew_cursor = true;
                            delete cursorBmp;
                        }
                        if (ii.hbmMask) DeleteObject(ii.hbmMask);
                        if (ii.hbmColor) DeleteObject(ii.hbmColor);
                    }
                }

                if (!drew_cursor) {
                    // Crisp standard arrow cursor fallback
                    Point arrowPts[] = {
                        Point(cur.x, cur.y), Point(cur.x, cur.y + 18), Point(cur.x + 4, cur.y + 14),
                        Point(cur.x + 8, cur.y + 22), Point(cur.x + 11, cur.y + 21), Point(cur.x + 7, cur.y + 13), Point(cur.x + 13, cur.y + 13)
                    };
                    SolidBrush arrowFill(Color(255, 255, 255, 255));
                    Pen arrowBorder(Color(255, 20, 20, 20), 1.8f);
                    g.FillPolygon(&arrowFill, arrowPts, 7);
                    g.DrawPolygon(&arrowBorder, arrowPts, 7);
                }

                LeaveCriticalSection(&g_mouse_cs);
            }

            // 3. Write raw BGR0 frame to stdout pipe for FFmpeg
            DWORD written = 0;
            BOOL write_ok = WriteFile(stdout_handle, frame_buf.data(), (DWORD)frame_buf.size(), &written, NULL);
            if (!write_ok || written != frame_buf.size()) {
                // Pipe broken (FFmpeg exited or closed stdin)
                break;
            }
        }

        // 4. Frame pacing
        auto t_end = std::chrono::steady_clock::now();
        int elapsed_ms = (int)std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_start).count();
        int sleep_ms = frame_time_ms - elapsed_ms;
        if (sleep_ms > 0) {
            Sleep(sleep_ms);
        }
    }

    g_running = false;
    timeEndPeriod(1);
    dxgi.Release();
    gdi.Release();
    GdiplusShutdown(gdiplusToken);
    DeleteCriticalSection(&g_mouse_cs);

    return 0;
}
