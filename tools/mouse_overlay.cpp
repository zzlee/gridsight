#define UNICODE
#define _UNICODE
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <algorithm>

#pragma comment(lib, "user32.lib")

/*
 * GridSight Headless Mouse Event Hook Daemon (GridSightMouseOverlay.exe)
 *
 * Captures Windows low-level mouse events (WH_MOUSE_LL) with 0ms latency
 * and pipes them over stdout (EV lines) to Node.js TeacherInputRtpStreamer.
 *
 * NOTE: This daemon does NOT create any overlay window or visual ripples
 * on the teacher's desktop. The video capture remains 100% clean and pristine,
 * leaving all cursor and ripple rendering exclusively to the student agent.
 */

enum ClickType {
    CLICK_LEFT,
    CLICK_RIGHT,
    CLICK_MIDDLE
};

static HHOOK g_hook = NULL;
static POINT g_last_cursor_pos = {0, 0};

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

LRESULT CALLBACK MouseHookProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        MSLLHOOKSTRUCT* hook = (MSLLHOOKSTRUCT*)lParam;
        if (wParam == WM_MOUSEMOVE) {
            if (hook->pt.x != g_last_cursor_pos.x || hook->pt.y != g_last_cursor_pos.y) {
                DWORD now = GetTickCount();
                g_last_cursor_pos = hook->pt;

                if (now - g_last_move_emit_time >= 16) {
                    g_last_move_emit_time = now;
                    EmitInputEvent(1 /* MouseMove */, hook->pt.x, hook->pt.y, 0, 0);
                }
            }
        } else if (wParam == WM_LBUTTONDOWN || wParam == WM_RBUTTONDOWN || wParam == 0x0207 /* WM_MBUTTONDOWN */) {
            ClickType type = (wParam == WM_LBUTTONDOWN) ? CLICK_LEFT : 
                             (wParam == WM_RBUTTONDOWN) ? CLICK_RIGHT : CLICK_MIDDLE;
            if (type == CLICK_LEFT) g_current_button_flags |= 0x01;
            else if (type == CLICK_RIGHT) g_current_button_flags |= 0x02;
            else g_current_button_flags |= 0x04;

            EmitInputEvent(2 /* MouseDown */, hook->pt.x, hook->pt.y, 0, 0);
        } else if (wParam == WM_LBUTTONUP || wParam == WM_RBUTTONUP || wParam == 0x0208 /* WM_MBUTTONUP */) {
            if (wParam == WM_LBUTTONUP) g_current_button_flags &= ~0x01;
            else if (wParam == WM_RBUTTONUP) g_current_button_flags &= ~0x02;
            else g_current_button_flags &= ~0x04;

            EmitInputEvent(3 /* MouseUp */, hook->pt.x, hook->pt.y, 0, 0);
        } else if (wParam == WM_MOUSEWHEEL) {
            short delta = (short)HIWORD(hook->mouseData);
            EmitInputEvent(4 /* Scroll */, hook->pt.x, hook->pt.y, delta, 0);
        }
    }
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE, LPSTR lpCmdLine, int) {
    (void)hInstance;
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

    g_screen_x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    g_screen_y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    g_screen_w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    g_screen_h = GetSystemMetrics(SM_CYVIRTUALSCREEN);

    g_hook = SetWindowsHookEx(WH_MOUSE_LL, MouseHookProc, GetModuleHandle(NULL), 0);
    if (!g_hook) {
        if (g_stdout_handle && g_stdout_handle != INVALID_HANDLE_VALUE) {
            char err_msg[64];
            snprintf(err_msg, sizeof(err_msg), "ERR HookFailed %lu\n", GetLastError());
            DWORD wr = 0;
            WriteFile(g_stdout_handle, err_msg, (DWORD)strlen(err_msg), &wr, NULL);
            FlushFileBuffers(g_stdout_handle);
        }
        return 1;
    }

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (g_hook) UnhookWindowsHookEx(g_hook);
    return 0;
}
