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

struct ClickEffect {
    int x;
    int y;
    float radius;
    float max_radius;
    float alpha;
    bool is_left;
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
        g_anim_timer = SetTimer(g_hwnd, 1, 16, NULL); // ~60 FPS
    }
}

static void InvalidateHalo(int x, int y) {
    if (!g_hwnd) return;
    int r = 36;
    RECT rc = { x - r, y - r, x + r, y + r };
    InvalidateRect(g_hwnd, &rc, FALSE);
}

static void InvalidateArea(int x, int y, int radius) {
    if (!g_hwnd) return;
    int r = radius + 10;
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
        } else if (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN) {
            bool is_left = (wParam == WM_LBUTTONDOWN);
            if (g_click_effects.size() >= MAX_EFFECTS) {
                g_click_effects.erase(g_click_effects.begin());
            }
            ClickEffect eff;
            eff.x = hook->pt.x;
            eff.y = hook->pt.y;
            eff.radius = 12.0f;
            eff.max_radius = is_left ? 46.0f : 54.0f;
            eff.alpha = 240.0f;
            eff.is_left = is_left;
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
            eff.alpha = 240.0f;
            eff.is_up = is_up;
            g_scroll_effects.push_back(eff);
            EnsureTimer();
            InvalidateArea(hook->pt.x, hook->pt.y, 40);
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
            // Update click effects
            for (size_t i = 0; i < g_click_effects.size(); ) {
                auto& eff = g_click_effects[i];
                eff.radius += (eff.max_radius - eff.radius) * 0.28f + 0.8f;
                eff.alpha -= 16.0f;
                InvalidateArea(eff.x, eff.y, (int)eff.max_radius);
                if (eff.alpha <= 0.0f || eff.radius >= eff.max_radius) {
                    g_click_effects.erase(g_click_effects.begin() + i);
                } else {
                    has_active = true;
                    ++i;
                }
            }

            // Update scroll effects
            for (size_t i = 0; i < g_scroll_effects.size(); ) {
                auto& eff = g_scroll_effects[i];
                eff.offset_y += eff.is_up ? -2.2f : 2.2f;
                eff.alpha -= 14.0f;
                InvalidateArea(eff.x, eff.y + (int)eff.offset_y, 30);
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

            // Halo (Yellow, radius 24)
            SolidBrush haloBrush(Color(100, 255, 235, 59));
            Pen haloPen(Color(180, 255, 193, 7), 1.8f);
            int r = 24;
            g.FillEllipse(&haloBrush, cx - r, cy - r, r * 2, r * 2);
            g.DrawEllipse(&haloPen, cx - r, cy - r, r * 2, r * 2);

            // Click Ripples
            for (const auto& eff : g_click_effects) {
                int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
                Color color = eff.is_left ? Color(a, 0, 229, 255) : Color(a, 255, 152, 0);
                Pen clickPen(color, eff.is_left ? 3.5f : 4.5f);
                g.DrawEllipse(&clickPen, eff.x - eff.radius, eff.y - eff.radius, eff.radius * 2, eff.radius * 2);
                if (!eff.is_left) {
                    float inner_r = std::max(2.0f, eff.radius - 12.0f);
                    g.DrawEllipse(&clickPen, eff.x - inner_r, eff.y - inner_r, inner_r * 2, inner_r * 2);
                }
            }

            // Scroll arrows
            FontFamily fontFamily(L"Segoe UI");
            Font font(&fontFamily, 11, FontStyleBold, UnitPixel);
            for (const auto& eff : g_scroll_effects) {
                int a = (int)std::max(0.0f, std::min(255.0f, eff.alpha));
                SolidBrush bubbleBrush(Color(a, 15, 23, 42));
                SolidBrush textBrush(Color(a, 56, 189, 248));
                int x = eff.x;
                int y = (int)(eff.y + eff.offset_y);
                g.FillEllipse(&bubbleBrush, x - 12, y - 12, 24, 24);
                const wchar_t* arrow = eff.is_up ? L"▲" : L"▼";
                PointF origin((REAL)(x - 7), (REAL)(y - 7));
                g.DrawString(arrow, -1, &font, origin, &textBrush);
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
