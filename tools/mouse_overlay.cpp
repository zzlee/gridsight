#define UNICODE
#define _UNICODE
#include <windows.h>
#include <gdiplus.h>
#include <vector>
#include <chrono>
#include <algorithm>
#include <string>

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

static HWND g_hwnd = NULL;
static HHOOK g_hook = NULL;
static std::vector<ClickEffect> g_click_effects;
static std::vector<ScrollEffect> g_scroll_effects;
static UINT_PTR g_anim_timer = 0;
static POINT g_last_cursor_pos = {0, 0};
static const int MAX_EFFECTS = 8;

static void EnsureTimer() {
    if (g_anim_timer == 0 && g_hwnd) {
        g_anim_timer = SetTimer(g_hwnd, 1, 16, NULL); // ~60 FPS animation
    }
}

static void InvalidateHalo(int x, int y) {
    if (!g_hwnd) return;
    int r = 24; // Compact halo bounds
    RECT rc = { x - r, y - r, x + r, y + r };
    InvalidateRect(g_hwnd, &rc, FALSE);
}

static void InvalidateArea(int x, int y, int radius) {
    if (!g_hwnd) return;
    int r = radius + 6;
    RECT rc = { x - r, y - r, x + r, y + r };
    InvalidateRect(g_hwnd, &rc, FALSE);
}

LRESULT CALLBACK MouseHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && g_hwnd) {
        MSLLHOOKSTRUCT* hook = (MSLLHOOKSTRUCT*)lParam;
        if (wParam == WM_MOUSEMOVE) {
            int old_x = g_last_cursor_pos.x;
            int old_y = g_last_cursor_pos.y;
            g_last_cursor_pos = hook->pt;
            InvalidateHalo(old_x, old_y);
            InvalidateHalo(hook->pt.x, hook->pt.y);
        } else if (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN || wParam == 0x0207 /* WM_MBUTTONDOWN */) {
            ClickType type = (wParam == WM_LBUTTONDOWN) ? CLICK_LEFT : 
                             (wParam == WM_RBUTTONDOWN) ? CLICK_RIGHT : CLICK_MIDDLE;
            
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
            InvalidateArea(hook->pt.x, hook->pt.y, (int)eff.max_radius);
        } else if (wParam == WM_MOUSEWHEEL) {
            short delta = (short)HIWORD(hook->mouseData);
            bool is_up = (delta > 0);
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
            InvalidateArea(hook->pt.x, hook->pt.y, 25);
        }
    }
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE:
        return 0;

    case WM_TIMER:
        if (wParam == 1) {
            bool has_active = false;
            // Update click ripple animations
            for (size_t i = 0; i < g_click_effects.size(); ) {
                auto& eff = g_click_effects[i];
                eff.radius += (eff.max_radius - eff.radius) * 0.32f + 0.6f;
                eff.alpha -= 18.0f;
                InvalidateArea(eff.x, eff.y, (int)eff.max_radius);
                if (eff.alpha <= 0.0f || eff.radius >= eff.max_radius) {
                    g_click_effects.erase(g_click_effects.begin() + i);
                } else {
                    has_active = true;
                    ++i;
                }
            }

            // Update scroll wheel floating indicator animations
            for (size_t i = 0; i < g_scroll_effects.size(); ) {
                auto& eff = g_scroll_effects[i];
                eff.offset_y += eff.is_up ? -1.8f : 1.8f;
                eff.alpha -= 16.0f;
                InvalidateArea(eff.x, eff.y + (int)eff.offset_y, 25);
                if (eff.alpha <= 0.0f) {
                    g_scroll_effects.erase(g_scroll_effects.begin() + i);
                } else {
                    has_active = true;
                    ++i;
                }
            }

            if (!has_active) {
                KillTimer(hwnd, 1);
                g_anim_timer = 0;
            }
        }
        return 0;

    case WM_ERASEBKGND:
        return 1;

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        int client_w = rc.right - rc.left;
        int client_h = rc.bottom - rc.top;

        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, client_w, client_h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        // Fill transparent color key (RGB 15, 23, 42)
        HBRUSH bgBrush = CreateSolidBrush(RGB(15, 23, 42));
        FillRect(memDC, &rc, bgBrush);
        DeleteObject(bgBrush);

        {
            Graphics g(memDC);
            g.SetSmoothingMode(SmoothingModeAntiAlias);

            POINT pt;
            GetCursorPos(&pt);
            int cx = pt.x;
            int cy = pt.y;

            // 1. Compact, subtle, non-obstructive Idle Halo (Radius 13, hollow center with faint glow)
            int r = 13;
            SolidBrush faintGlow(Color(25, 255, 235, 59));   // 10% opacity center
            Pen ringPen(Color(140, 255, 193, 7), 1.5f);        // Subtle yellow outline
            g.FillEllipse(&faintGlow, cx - r, cy - r, r * 2, r * 2);
            g.DrawEllipse(&ringPen, cx - r, cy - r, r * 2, r * 2);

            // 2. Click Ripple Animations
            for (const auto& eff : g_click_effects) {
                int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
                
                if (eff.type == CLICK_LEFT) {
                    // Left Click: Bright Cyan Expanding Wave + Center Click Dot
                    Pen leftPen(Color(a, 0, 229, 255), 2.2f);
                    g.DrawEllipse(&leftPen, eff.x - eff.radius, eff.y - eff.radius, eff.radius * 2, eff.radius * 2);
                    
                    if (eff.radius < 16.0f) {
                        SolidBrush dotBrush(Color(a, 0, 229, 255));
                        g.FillEllipse(&dotBrush, eff.x - 3, eff.y - 3, 6, 6);
                    }
                } else if (eff.type == CLICK_RIGHT) {
                    // Right Click: Double Concentric Amber/Orange Rings
                    Pen rightPen1(Color(a, 255, 152, 0), 2.4f);
                    Pen rightPen2(Color((int)(a * 0.7f), 255, 87, 34), 1.4f);
                    g.DrawEllipse(&rightPen1, eff.x - eff.radius, eff.y - eff.radius, eff.radius * 2, eff.radius * 2);
                    float inner_r = std::max(2.0f, eff.radius - 9.0f);
                    g.DrawEllipse(&rightPen2, eff.x - inner_r, eff.y - inner_r, inner_r * 2, inner_r * 2);
                } else {
                    // Middle Click: Violet/Purple Ring Pulse
                    Pen midPen(Color(a, 168, 85, 247), 2.2f);
                    g.DrawEllipse(&midPen, eff.x - eff.radius, eff.y - eff.radius, eff.radius * 2, eff.radius * 2);
                }
            }

            // 3. Scroll Wheel Floating Indicators (Micro-Bubble with ▲ / ▼)
            FontFamily fontFamily(L"Segoe UI");
            Font font(&fontFamily, 9, FontStyleBold, UnitPixel);
            for (const auto& eff : g_scroll_effects) {
                int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
                SolidBrush bubbleBrush(Color((int)(a * 0.75f), 15, 23, 42));
                SolidBrush textBrush(Color(a, 56, 189, 248));
                Pen bubblePen(Color((int)(a * 0.5f), 56, 189, 248), 1.0f);
                
                int x = eff.x + 12; // Offset to bottom-right of cursor
                int y = (int)(eff.y + eff.offset_y + 6);
                int bw = 16;
                int bh = 16;
                
                g.FillEllipse(&bubbleBrush, x - bw/2, y - bh/2, bw, bh);
                g.DrawEllipse(&bubblePen, x - bw/2, y - bh/2, bw, bh);
                
                const wchar_t* arrow = eff.is_up ? L"▲" : L"▼";
                PointF origin((REAL)(x - 5), (REAL)(y - 6));
                g.DrawString(arrow, -1, &font, origin, &textBrush);
            }

            // 4. Render exact Real-Time Windows Cursor Icon on top of halo/animations
            CURSORINFO ci = { sizeof(CURSORINFO) };
            if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING) && ci.hCursor) {
                ICONINFO ii = { 0 };
                if (GetIconInfo(ci.hCursor, &ii)) {
                    DrawIconEx(memDC, 
                               cx - ii.xHotspot, 
                               cy - ii.yHotspot, 
                               ci.hCursor, 
                               0, 0, 0, NULL, DI_NORMAL);
                    if (ii.hbmColor) DeleteObject(ii.hbmColor);
                    if (ii.hbmMask) DeleteObject(ii.hbmMask);
                } else {
                    DrawIconEx(memDC, cx, cy, ci.hCursor, 0, 0, 0, NULL, DI_NORMAL);
                }
            }
        }

        BitBlt(hdc, 0, 0, client_w, client_h, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }

    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR, int) {
    GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken;
    GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, NULL);

    WNDCLASSEX wc = {0};
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"GridSightMouseOverlayClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassEx(&wc);

    int screen_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int screen_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int screen_w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int screen_h = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    g_hwnd = CreateWindowEx(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        L"GridSightMouseOverlayClass",
        L"GridSight Mouse Overlay",
        WS_POPUP,
        screen_x, screen_y, screen_w, screen_h,
        NULL, NULL, hInstance, NULL
    );

    if (!g_hwnd) return 1;

    // Color key RGB(15, 23, 42) is 100% transparent
    SetLayeredWindowAttributes(g_hwnd, RGB(15, 23, 42), 0, LWA_COLORKEY);
    ShowWindow(g_hwnd, SW_SHOW);
    SetWindowPos(g_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    g_hook = SetWindowsHookEx(WH_MOUSE_LL, MouseHookProc, hInstance, 0);

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (g_hook) UnhookWindowsHookEx(g_hook);
    GdiplusShutdown(gdiplusToken);
    return 0;
}
