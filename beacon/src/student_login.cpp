#include "../include/utils.h"

#ifdef _WIN32
#include <windows.h>
#include <commctrl.h>
#include <string>

namespace GridSight {

static std::string g_student_id_result = "";
static HWND g_hEdit = NULL;

LRESULT CALLBACK LoginWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE: {
            CreateWindowW(L"STATIC", L"請輸入您的學號 (Student ID):", WS_VISIBLE | WS_CHILD | SS_CENTERIMAGE, 20, 20, 300, 24, hwnd, NULL, ((LPCREATESTRUCT)lParam)->hInstance, NULL);
            g_hEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_VISIBLE | WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL, 20, 50, 300, 28, hwnd, (HMENU)101, ((LPCREATESTRUCT)lParam)->hInstance, NULL);
            CreateWindowW(L"BUTTON", L"確認登入", WS_VISIBLE | WS_CHILD | WS_TABSTOP | BS_DEFPUSHBUTTON, 120, 95, 100, 35, hwnd, (HMENU)102, ((LPCREATESTRUCT)lParam)->hInstance, NULL);

            HFONT hFont = CreateFontW(18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
            EnumChildWindows(hwnd, [](HWND child, LPARAM font) -> BOOL {
                SendMessage(child, WM_SETFONT, font, TRUE);
                return TRUE;
            }, (LPARAM)hFont);
            SetFocus(g_hEdit);
            break;
        }
        case WM_COMMAND: {
            if (LOWORD(wParam) == 102) { // Submit button
                wchar_t buffer[256];
                GetWindowTextW(g_hEdit, buffer, 256);

                int utf8_len = WideCharToMultiByte(CP_UTF8, 0, buffer, -1, NULL, 0, NULL, NULL);
                if (utf8_len > 0) {
                    std::string utf8_str(utf8_len, '\0');
                    WideCharToMultiByte(CP_UTF8, 0, buffer, -1, &utf8_str[0], utf8_len, NULL, NULL);
                    if (!utf8_str.empty() && utf8_str.back() == '\0') {
                        utf8_str.pop_back();
                    }
                    g_student_id_result = utf8_str;
                }

                if (g_student_id_result.empty()) {
                    MessageBoxW(hwnd, L"學號不能為空！", L"錯誤", MB_ICONWARNING | MB_OK);
                } else {
                    PostQuitMessage(0);
                }
            }
            break;
        }
        case WM_CLOSE: {
            MessageBoxW(hwnd, L"請輸入學號以繼續使用系統。", L"提示", MB_ICONINFORMATION | MB_OK);
            break;
        }
        case WM_DESTROY: {
            PostQuitMessage(0);
            break;
        }
        default:
            return DefWindowProcW(hwnd, msg, wParam, lParam);
    }
    return 0;
}

std::string Utils::ShowStudentLoginDialog() {
    HINSTANCE hInstance = GetModuleHandle(NULL);
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = LoginWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"GridSightLoginClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassW(&wc);

    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);
    int win_w = 360;
    int win_h = 180;
    int x = (screen_w - win_w) / 2;
    int y = (screen_h - win_h) / 2;

    HWND hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_APPWINDOW, L"GridSightLoginClass", L"GridSight 學生登入系統", WS_POPUP | WS_BORDER | WS_CAPTION | WS_SYSMENU | WS_VISIBLE, x, y, win_w, win_h, NULL, NULL, hInstance, NULL);

    if (hwnd) {
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);

        MSG msg;
        while (GetMessage(&msg, NULL, 0, 0)) {
            if (!IsDialogMessage(hwnd, &msg)) {
                TranslateMessage(&msg);
                DispatchMessage(&msg);
            }
        }

        DestroyWindow(hwnd);
        UnregisterClassW(L"GridSightLoginClass", hInstance);
    }

    return g_student_id_result;
}

} // namespace GridSight
#else
namespace GridSight {
std::string Utils::ShowStudentLoginDialog() {
    return "UNKNOWN_ID"; // Fallback for non-Windows
}
} // namespace GridSight
#endif
