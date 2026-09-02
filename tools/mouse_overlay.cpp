#define UNICODE
#define _UNICODE
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <windows.h>
#include <gdiplus.h>
#include <vector>
#include <algorithm>
#include <cstdint>
#include <cstdio>

#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

using namespace Gdiplus;

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

static HWND g_hwnd = NULL;
static HHOOK g_hook = NULL;
static std::vector<ClickEffect> g_click_effects;
static std::vector<ScrollEffect> g_scroll_effects;
static std::vector<MoveEffect> g_move_effects;
static UINT_PTR g_anim_timer = 0;
static POINT g_last_cursor_pos = {0, 0};
static DWORD g_last_move_time = 0;
static const int MAX_EFFECTS = 8;

static int g_screen_x = 0;
static int g_screen_y = 0;
static int g_screen_w = 0;
static int g_screen_h = 0;

static HANDLE g_stdout_handle = NULL;
static bool g_emit_events = false;
static uint8_t g_current_button_flags = 0;
static DWORD g_last_move_emit_time = 0;

static uint8_t GetCurrentModifierFlags() {
    uint8_t flags = 0;
    if (GetKeyState(VK_CONTROL) & 0x8000) flags |= 0x01;
    if (GetKeyState(VK_SHIFT) & 0x8000)   flags |= 0x02;
    if (GetKeyState(VK_MENU) & 0x8000)    flags |= 0x04;
    if ((GetKeyState(VK_LWIN) | GetKeyState(VK_RWIN)) & 0x8000) flags |= 0x08;
    return flags;
}

static void EmitInputEvent(int type, int screen_px_x, int screen_px_y, int16_t scroll_delta, uint32_t key_code) {
    if (!g_emit_events || !g_stdout_handle || g_stdout_handle == INVALID_HANDLE_VALUE) return;
    int scr_w = (g_screen_w > 0) ? g_screen_w : 1;
    int scr_h = (g_screen_h > 0) ? g_screen_h : 1;
    int rel_x = screen_px_x - g_screen_x;
    int rel_y = screen_px_y - g_screen_y;
    uint16_t norm_x = (uint16_t)std::max(0, std::min(65535, (int)((double)rel_x / scr_w * 65535.0)));
    uint16_t norm_y = (uint16_t)std::max(0, std::min(65535, (int)((double)rel_y / scr_h * 65535.0)));
    uint8_t mod_flags = GetCurrentModifierFlags();

    char buf[128];
    ULONGLONG now_ms = GetTickCount64();
    int len = snprintf(buf, sizeof(buf), "EV %d %u %u %u %d %u %u %llu\n",
                       type, (unsigned int)norm_x, (unsigned int)norm_y,
                       (unsigned int)g_current_button_flags,
                       (int)scroll_delta, (unsigned int)mod_flags,
                       (unsigned int)key_code, (unsigned long long)now_ms);
    if (len > 0) {
        DWORD written = 0;
        WriteFile(g_stdout_handle, buf, (DWORD)len, &written, NULL);
        FlushFileBuffers(g_stdout_handle);
    }
}

static HDC g_memDC = NULL;
static HBITMAP g_memDIB = NULL;
static void* g_pBits = NULL;

static void RenderAndCommit();

static void EnsureTimer() {
    if (g_anim_timer == 0 && g_hwnd) {
        g_anim_timer = SetTimer(g_hwnd, 1, 16, NULL); // ~60 FPS
    }
}

static void RenderAndCommit() {
    if (!g_hwnd || !g_memDC || !g_pBits) return;

    // Fast zero-fill 32-bit ARGB buffer (100% transparent)
    memset(g_pBits, 0, g_screen_w * g_screen_h * 4);

    {
        Graphics g(g_memDC);
        g.SetSmoothingMode(SmoothingModeAntiAlias);
        g.SetTextRenderingHint(TextRenderingHintAntiAliasGridFit);

        POINT pt;
        GetCursorPos(&pt);
        int cx = pt.x - g_screen_x;
        int cy = pt.y - g_screen_y;

        // 1. Render Move Ripple Effect (Sky Blue #38bdf8 following live cursor on motion after >=1s idle)
        for (const auto& eff : g_move_effects) {
            int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
            Pen movePen(Color(a, 56, 189, 248), 2.0f);
            SolidBrush moveBrush(Color((int)(a * 0.25f), 56, 189, 248));
            g.FillEllipse(&moveBrush, cx - eff.radius, cy - eff.radius, eff.radius * 2.0f, eff.radius * 2.0f);
            g.DrawEllipse(&movePen, cx - eff.radius, cy - eff.radius, eff.radius * 2.0f, eff.radius * 2.0f);
        }

        // 2. Click Ripple Animations
        for (const auto& eff : g_click_effects) {
            int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
            int ex = eff.x - g_screen_x;
            int ey = eff.y - g_screen_y;

            if (eff.type == CLICK_LEFT) {
                // Left Click: Bright Cyan Expanding Wave + Click Center Point
                Pen leftPen(Color(a, 0, 229, 255), 2.2f);
                g.DrawEllipse(&leftPen, ex - eff.radius, ey - eff.radius, eff.radius * 2, eff.radius * 2);
                if (eff.radius < 16.0f) {
                    SolidBrush dotBrush(Color(a, 0, 229, 255));
                    g.FillEllipse(&dotBrush, ex - 3, ey - 3, 6, 6);
                }
            } else if (eff.type == CLICK_RIGHT) {
                // Right Click: Double Concentric Amber/Orange Rings
                Pen rightPen1(Color(a, 255, 152, 0), 2.4f);
                Pen rightPen2(Color((int)(a * 0.7f), 255, 87, 34), 1.4f);
                g.DrawEllipse(&rightPen1, ex - eff.radius, ey - eff.radius, eff.radius * 2, eff.radius * 2);
                float inner_r = std::max(2.0f, eff.radius - 8.0f);
                g.DrawEllipse(&rightPen2, ex - inner_r, ey - inner_r, inner_r * 2, inner_r * 2);
            } else {
                // Middle Click: Violet Pulse Ring
                Pen midPen(Color(a, 168, 85, 247), 2.2f);
                g.DrawEllipse(&midPen, ex - eff.radius, ey - eff.radius, eff.radius * 2, eff.radius * 2);
            }
        }

        // 3. Scroll Wheel Floating Indicators (Micro Bubble with ▲ / ▼)
        FontFamily fontFamily(L"Segoe UI");
        Font font(&fontFamily, 9, FontStyleBold, UnitPixel);
        for (const auto& eff : g_scroll_effects) {
            int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
            int ex = eff.x - g_screen_x + 12;
            int ey = (int)(eff.y - g_screen_y + eff.offset_y + 6);

            SolidBrush bubbleBrush(Color((int)(a * 0.75f), 15, 23, 42));
            SolidBrush textBrush(Color(a, 56, 189, 248));
            Pen bubblePen(Color((int)(a * 0.5f), 56, 189, 248), 1.0f);

            int bw = 16;
            int bh = 16;
            g.FillEllipse(&bubbleBrush, ex - bw/2, ey - bh/2, bw, bh);
            g.DrawEllipse(&bubblePen, ex - bw/2, ey - bh/2, bw, bh);

            const wchar_t* arrow = eff.is_up ? L"▲" : L"▼";
            PointF origin((REAL)(ex - 5), (REAL)(ey - 6));
            g.DrawString(arrow, -1, &font, origin, &textBrush);
        }

        // 4. Authentic Real-Time Windows Cursor Icon on top
        CURSORINFO ci = { sizeof(CURSORINFO) };
        bool drew_cursor = false;
        if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING) && ci.hCursor) {
            ICONINFO ii = { 0 };
            if (GetIconInfo(ci.hCursor, &ii)) {
                Bitmap* pBmp = Bitmap::FromHICON(ci.hCursor);
                if (pBmp && pBmp->GetLastStatus() == Ok && pBmp->GetWidth() > 0) {
                    g.DrawImage(pBmp, cx - (int)ii.xHotspot, cy - (int)ii.yHotspot);
                    drew_cursor = true;
                    delete pBmp;
                }
                if (ii.hbmColor) DeleteObject(ii.hbmColor);
                if (ii.hbmMask) DeleteObject(ii.hbmMask);
            }
        }

        if (!drew_cursor) {
            // High-precision standard Windows Arrow Pointer (Hotspot at cx, cy)
            Point arrowPts[7] = {
                Point(cx, cy),
                Point(cx, cy + 18),
                Point(cx + 4, cy + 14),
                Point(cx + 8, cy + 22),
                Point(cx + 11, cy + 21),
                Point(cx + 7, cy + 13),
                Point(cx + 13, cy + 13)
            };
            SolidBrush arrowFill(Color(255, 255, 255, 255));
            Pen arrowBorder(Color(255, 0, 0, 0), 1.6f);
            g.FillPolygon(&arrowFill, arrowPts, 7);
            g.DrawPolygon(&arrowBorder, arrowPts, 7);
        }
    }

    // Commit 32-bit ARGB surface with True Per-Pixel Alpha Blending to DWM
    HDC screenDC = GetDC(NULL);
    POINT ptDst = { g_screen_x, g_screen_y };
    SIZE sz = { g_screen_w, g_screen_h };
    POINT ptSrc = { 0, 0 };
    BLENDFUNCTION blend = { AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
    UpdateLayeredWindow(g_hwnd, screenDC, &ptDst, &sz, g_memDC, &ptSrc, 0, &blend, ULW_ALPHA);
    ReleaseDC(NULL, screenDC);
}

LRESULT CALLBACK MouseHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_hwnd) {
        MSLLHOOKSTRUCT* hook = (MSLLHOOKSTRUCT*)lParam;
        if (wParam == WM_MOUSEMOVE) {
            if (hook->pt.x != g_last_cursor_pos.x || hook->pt.y != g_last_cursor_pos.y) {
                DWORD now = GetTickCount();
                if (g_last_move_time != 0 && (now - g_last_move_time) >= 1000) {
                    g_move_effects.clear();
                    MoveEffect eff;
                    eff.radius = 4.0f;
                    eff.max_radius = 20.0f;
                    eff.alpha = 255.0f;
                    eff.start_time = now;
                    g_move_effects.push_back(eff);
                    EnsureTimer();
                }
                g_last_move_time = now;
                g_last_cursor_pos = hook->pt;

                if (now - g_last_move_emit_time >= 16) {
                    g_last_move_emit_time = now;
                    EmitInputEvent(1 /* MouseMove */, hook->pt.x, hook->pt.y, 0, 0);
                }
            }
            RenderAndCommit();
        } else if (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN || wParam == 0x0207 /* WM_MBUTTONDOWN */) {
            ClickType type = (wParam == WM_LBUTTONDOWN) ? CLICK_LEFT : 
                             (wParam == WM_RBUTTONDOWN) ? CLICK_RIGHT : CLICK_MIDDLE;
            if (type == CLICK_LEFT) g_current_button_flags |= 0x01;
            else if (type == CLICK_RIGHT) g_current_button_flags |= 0x02;
            else g_current_button_flags |= 0x04;

            EmitInputEvent(2 /* MouseDown */, hook->pt.x, hook->pt.y, 0, 0);

            if (g_click_effects.size() >= MAX_EFFECTS) {
                g_click_effects.erase(g_click_effects.begin());
            }
            ClickEffect eff;
            eff.x = hook->pt.x;
            eff.y = hook->pt.y;
            eff.radius = (type == CLICK_RIGHT) ? 8.0f : 6.0f;
            eff.max_radius = (type == CLICK_LEFT) ? 32.0f : (type == CLICK_RIGHT) ? 38.0f : 28.0f;
            eff.alpha = 240.0f;
            eff.type = type;
            g_click_effects.push_back(eff);
            EnsureTimer();
            RenderAndCommit();
        } else if (wParam == WM_LBUTTONUP || wParam == WM_RBUTTONUP || wParam == 0x0208 /* WM_MBUTTONUP */) {
            if (wParam == WM_LBUTTONUP) g_current_button_flags &= ~0x01;
            else if (wParam == WM_RBUTTONUP) g_current_button_flags &= ~0x02;
            else g_current_button_flags &= ~0x04;

            EmitInputEvent(3 /* MouseUp */, hook->pt.x, hook->pt.y, 0, 0);
        } else if (wParam == WM_MOUSEWHEEL) {
            short delta = (short)HIWORD(hook->mouseData);
            bool is_up = (delta > 0);
            EmitInputEvent(4 /* Scroll */, hook->pt.x, hook->pt.y, delta, 0);

            if (g_scroll_effects.size() >= MAX_EFFECTS) {
                g_scroll_effects.erase(g_scroll_effects.begin());
            }
            ScrollEffect eff;
            eff.x = hook->pt.x;
            eff.y = hook->pt.y;
            eff.offset_y = 0.0f;
            eff.alpha = 230.0f;
            eff.is_up = is_up;
            g_scroll_effects.push_back(eff);
            EnsureTimer();
            RenderAndCommit();
        }
    }
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_TIMER:
        if (wParam == 1) {
            bool has_active = false;
            for (size_t i = 0; i < g_click_effects.size(); ) {
                auto& eff = g_click_effects[i];
                eff.radius += (eff.max_radius - eff.radius) * 0.32f + 0.6f;
                eff.alpha -= 18.0f;
                if (eff.alpha <= 0.0f || eff.radius >= eff.max_radius) {
                    g_click_effects.erase(g_click_effects.begin() + i);
                } else {
                    has_active = true;
                    ++i;
                }
            }
            for (size_t i = 0; i < g_scroll_effects.size(); ) {
                auto& eff = g_scroll_effects[i];
                eff.offset_y += eff.is_up ? -1.8f : 1.8f;
                eff.alpha -= 16.0f;
                if (eff.alpha <= 0.0f) {
                    g_scroll_effects.erase(g_scroll_effects.begin() + i);
                } else {
                    has_active = true;
                    ++i;
                }
            }
            DWORD now = GetTickCount();
            for (size_t i = 0; i < g_move_effects.size(); ) {
                auto& eff = g_move_effects[i];
                DWORD elapsed = now - eff.start_time;
                float progress = (float)elapsed / 500.0f;
                if (progress >= 1.0f) {
                    g_move_effects.erase(g_move_effects.begin() + i);
                } else {
                    eff.radius = 4.0f + (eff.max_radius - 4.0f) * progress;
                    eff.alpha = 255.0f * (1.0f - progress);
                    has_active = true;
                    ++i;
                }
            }

            RenderAndCommit();

            if (!has_active) {
                KillTimer(hwnd, 1);
                g_anim_timer = 0;
            }
        }
        return 0;

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR lpCmdLine, int) {
    g_stdout_handle = GetStdHandle(STD_OUTPUT_HANDLE);
    if (!g_stdout_handle || g_stdout_handle == INVALID_HANDLE_VALUE) {
        AttachConsole(ATTACH_PARENT_PROCESS);
        g_stdout_handle = GetStdHandle(STD_OUTPUT_HANDLE);
    }
    if (g_stdout_handle != NULL && g_stdout_handle != INVALID_HANDLE_VALUE) {
        g_emit_events = true;
    }
    if (lpCmdLine && strstr(lpCmdLine, "--emit-events")) {
        g_emit_events = true;
    }

    if (g_stdout_handle && g_stdout_handle != INVALID_HANDLE_VALUE) {
        char init_msg[] = "READY GridSightMouseOverlay\n";
        DWORD wr = 0;
        WriteFile(g_stdout_handle, init_msg, (DWORD)strlen(init_msg), &wr, NULL);
        FlushFileBuffers(g_stdout_handle);
    }

    GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    WNDCLASSEX wc = {0};
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"GridSightMouseOverlayClass";
    RegisterClassEx(&wc);

    g_screen_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    g_screen_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    g_screen_w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    g_screen_h = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    // Create 32-bit ARGB DIB Section for True Per-Pixel Alpha Blending
    HDC screenDC = GetDC(NULL);
    g_memDC = CreateCompatibleDC(screenDC);

    BITMAPINFO bmi = {0};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = g_screen_w;
    bmi.bmiHeader.biHeight = -g_screen_h; // Top-down DIB
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    g_memDIB = CreateDIBSection(screenDC, &bmi, DIB_RGB_COLORS, &g_pBits, NULL, 0);
    SelectObject(g_memDC, g_memDIB);
    ReleaseDC(NULL, screenDC);

    g_hwnd = CreateWindowEx(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        L"GridSightMouseOverlayClass",
        L"GridSight Mouse Overlay",
        WS_POPUP,
        g_screen_x, g_screen_y, g_screen_w, g_screen_h,
        NULL, NULL, hInstance, NULL
    );

    if (!g_hwnd) return 1;

    ShowWindow(g_hwnd, SW_SHOW);
    SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    RenderAndCommit();

    g_hook = SetWindowsHookEx(WH_MOUSE_LL, MouseHookProc, GetModuleHandle(NULL), 0);
    if (!g_hook) {
        char err_msg[64];
        snprintf(err_msg, sizeof(err_msg), "ERR HookFailed %lu\n", GetLastError());
        DWORD wr = 0;
        WriteFile(g_stdout_handle, err_msg, (DWORD)strlen(err_msg), &wr, NULL);
        FlushFileBuffers(g_stdout_handle);
    }

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (g_hook) UnhookWindowsHookEx(g_hook);
    if (g_memDIB) DeleteObject(g_memDIB);
    if (g_memDC) DeleteDC(g_memDC);
    GdiplusShutdown(gdiplusToken);
    return 0;
}
