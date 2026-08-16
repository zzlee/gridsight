#include "../include/capture.h"
#include "../include/utils.h"
#include <iostream>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#endif

namespace GridSight {

ScreenCapturer::ScreenCapturer() = default;

ScreenCapturer::~ScreenCapturer() {
    Release();
}

bool ScreenCapturer::Initialize() {
    std::lock_guard<std::mutex> lock(capture_mutex_);
#ifdef _WIN32
    Utils::EnableDPIAwareness();
    screen_width_ = GetSystemMetrics(SM_CXSCREEN);
    screen_height_ = GetSystemMetrics(SM_CYSCREEN);

    if (screen_width_ <= 0 || screen_height_ <= 0) {
        screen_width_ = 1920;
        screen_height_ = 1080;
    }

    initialized_ = true;
    Utils::Log("INFO", "ScreenCapturer initialized: " + std::to_string(screen_width_) + "x" + std::to_string(screen_height_));
    return true;
#else
    screen_width_ = 1920;
    screen_height_ = 1080;
    initialized_ = true;
    return true;
#endif
}

bool ScreenCapturer::CaptureFrame(FrameData& out_frame) {
    std::lock_guard<std::mutex> lock(capture_mutex_);
    if (!initialized_) {
        if (!Initialize()) return false;
    }

    out_frame.width = screen_width_;
    out_frame.height = screen_height_;
    out_frame.pitch = screen_width_ * 4;
    out_frame.timestamp_ms = Utils::GetCurrentTimestampMs();
    out_frame.bgra_buffer.resize(screen_width_ * screen_height_ * 4);

#ifdef _WIN32
    // Windows GDI / DXGI Desktop Duplication fallback capture
    HDC hScreenDC = GetDC(NULL);
    HDC hMemoryDC = CreateCompatibleDC(hScreenDC);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreenDC, screen_width_, screen_height_);
    HBITMAP hOldBitmap = (HBITMAP)SelectObject(hMemoryDC, hBitmap);

    BitBlt(hMemoryDC, 0, 0, screen_width_, screen_height_, hScreenDC, 0, 0, SRCCOPY);

    BITMAPINFO bmi = {0};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = screen_width_;
    bmi.bmiHeader.biHeight = -screen_height_; // Top-down
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    GetDIBits(hMemoryDC, hBitmap, 0, screen_height_, out_frame.bgra_buffer.data(), &bmi, DIB_RGB_COLORS);

    SelectObject(hMemoryDC, hOldBitmap);
    DeleteObject(hBitmap);
    DeleteDC(hMemoryDC);
    ReleaseDC(NULL, hScreenDC);
    return true;
#else
    // Linux mock pattern frame
    for (int y = 0; y < screen_height_; ++y) {
        for (int x = 0; x < screen_width_; ++x) {
            int idx = (y * screen_width_ + x) * 4;
            out_frame.bgra_buffer[idx + 0] = (uint8_t)(x % 255);       // B
            out_frame.bgra_buffer[idx + 1] = (uint8_t)(y % 255);       // G
            out_frame.bgra_buffer[idx + 2] = (uint8_t)((x + y) % 255); // R
            out_frame.bgra_buffer[idx + 3] = 255;                      // A
        }
    }
    return true;
#endif
}

bool ScreenCapturer::ReacquireDuplication() {
    Release();
    return Initialize();
}

void ScreenCapturer::Release() {
    initialized_ = false;
}

} // namespace GridSight
