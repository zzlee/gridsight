#include "../include/capture.h"
#include "../include/utils.h"
#include <iostream>
#include <cstring>
#include <cmath>
#include <algorithm>

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
    return InitializeLocked();
}

bool ScreenCapturer::InitializeLocked() {
    if (initialized_) return true;
    ReleaseLocked();
#ifdef _WIN32
    Utils::EnableDPIAwareness();

    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    D3D_FEATURE_LEVEL feature_level;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &device, &feature_level, &context);
    if (FAILED(hr)) {
        Utils::Log("ERROR", "Failed to create D3D11 device.");
        return false;
    }

    IDXGIDevice* dxgi_device = nullptr;
    hr = device->QueryInterface(__uuidof(IDXGIDevice), (void**)&dxgi_device);
    if (FAILED(hr)) {
        device->Release();
        context->Release();
        return false;
    }

    IDXGIAdapter* adapter = nullptr;
    hr = dxgi_device->GetParent(__uuidof(IDXGIAdapter), (void**)&adapter);
    if (FAILED(hr)) {
        dxgi_device->Release();
        device->Release();
        context->Release();
        return false;
    }

    IDXGIOutput* output = nullptr;
    hr = adapter->EnumOutputs(0, &output);
    if (FAILED(hr)) {
        adapter->Release();
        dxgi_device->Release();
        device->Release();
        context->Release();
        return false;
    }

    IDXGIOutput1* output1 = nullptr;
    hr = output->QueryInterface(__uuidof(IDXGIOutput1), (void**)&output1);
    if (FAILED(hr)) {
        output->Release();
        adapter->Release();
        dxgi_device->Release();
        device->Release();
        context->Release();
        return false;
    }

    IDXGIOutputDuplication* dup = nullptr;
    hr = output1->DuplicateOutput(device, &dup);
    if (FAILED(hr)) {
        output1->Release();
        output->Release();
        adapter->Release();
        dxgi_device->Release();
        device->Release();
        context->Release();
        Utils::Log("ERROR", "Failed to duplicate output.");
        return false;
    }

    DXGI_OUTDUPL_DESC desc;
    dup->GetDesc(&desc);

    D3D11_TEXTURE2D_DESC tex_desc = {0};
    tex_desc.Width = desc.ModeDesc.Width;
    tex_desc.Height = desc.ModeDesc.Height;
    tex_desc.MipLevels = 1;
    tex_desc.ArraySize = 1;
    tex_desc.Format = desc.ModeDesc.Format;
    tex_desc.SampleDesc.Count = 1;
    tex_desc.Usage = D3D11_USAGE_STAGING;
    tex_desc.BindFlags = 0;
    tex_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    tex_desc.MiscFlags = 0;

    ID3D11Texture2D* staging_tex = nullptr;
    hr = device->CreateTexture2D(&tex_desc, nullptr, &staging_tex);
    if (FAILED(hr)) {
        dup->Release();
        output1->Release();
        output->Release();
        adapter->Release();
        dxgi_device->Release();
        device->Release();
        context->Release();
        return false;
    }

    screen_width_ = desc.ModeDesc.Width;
    screen_height_ = desc.ModeDesc.Height;

    dxgi_device_ = device;
    d3d_context_ = context;
    dxgi_dup_ = dup;
    staging_tex_ = staging_tex;

    output1->Release();
    output->Release();
    adapter->Release();
    dxgi_device->Release();

    initialized_ = true;
    frame_ready_ = false;
    Utils::Log("INFO", "ScreenCapturer initialized DXGI: " + std::to_string(screen_width_) + "x" + std::to_string(screen_height_));
    return true;
#else
    screen_width_ = 1920;
    screen_height_ = 1080;
    initialized_ = true;
    frame_ready_ = false;
    return true;
#endif
}

bool ScreenCapturer::CaptureFrame(FrameData& out_frame) {
    std::lock_guard<std::mutex> lock(capture_mutex_);
    if (!initialized_ && !InitializeLocked()) {
        return false;
    }

    out_frame.width = screen_width_;
    out_frame.height = screen_height_;
    out_frame.pitch = screen_width_ * 4;
    out_frame.timestamp_ms = Utils::GetCurrentTimestampMs();
    out_frame.bgra_buffer.resize(screen_width_ * screen_height_ * 4);

#ifdef _WIN32
    if (!dxgi_dup_ || !d3d_context_ || !staging_tex_ || !dxgi_device_) {
        return false;
    }

    IDXGIOutputDuplication* dup = (IDXGIOutputDuplication*)dxgi_dup_;
    ID3D11DeviceContext* context = (ID3D11DeviceContext*)d3d_context_;
    ID3D11Texture2D* staging_tex = (ID3D11Texture2D*)staging_tex_;

    DXGI_OUTDUPL_FRAME_INFO frame_info;
    IDXGIResource* desktop_resource = nullptr;

    HRESULT hr = dup->AcquireNextFrame(33, &frame_info, &desktop_resource);
    if (FAILED(hr)) {
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            // A timeout means the desktop is unchanged. Reuse the staging
            // texture only after at least one real frame has populated it.
            if (!frame_ready_) return false;
        } else {
            Utils::Log("ERROR", "DXGI AcquireNextFrame failed with HR: " + std::to_string(hr) + ". Reacquiring...");
            if (!ReacquireDuplicationLocked()) {
                Utils::Log("ERROR", "DXGI duplication reacquisition failed; capture will retry on the next request");
            }
            return false;
        }
    } else if (hr == S_OK) {
        bool copied_frame = false;
        if (desktop_resource) {
            ID3D11Texture2D* desktop_tex = nullptr;
            hr = desktop_resource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&desktop_tex);
            if (SUCCEEDED(hr)) {
                context->CopyResource(staging_tex, desktop_tex);
                desktop_tex->Release();
                copied_frame = true;
            }
            desktop_resource->Release();
        }
        dup->ReleaseFrame();
        if (!copied_frame) return false;
        frame_ready_ = true;
    }

    D3D11_MAPPED_SUBRESOURCE map;
    hr = context->Map(staging_tex, 0, D3D11_MAP_READ, 0, &map);
    if (SUCCEEDED(hr)) {
        if (map.RowPitch == (UINT)(screen_width_ * 4)) {
            memcpy(out_frame.bgra_buffer.data(), map.pData, screen_width_ * screen_height_ * 4);
        } else {
            const uint8_t* src = (const uint8_t*)map.pData;
            uint8_t* dst = out_frame.bgra_buffer.data();
            for (int y = 0; y < screen_height_; ++y) {
                memcpy(dst + y * screen_width_ * 4, src + y * map.RowPitch, screen_width_ * 4);
            }
        }
        context->Unmap(staging_tex, 0);
        last_success_timestamp_ms_ = Utils::GetCurrentTimestampMs();
        return true;
    }

    return false;
#else
    // Linux mock pattern frame: Realistic Windows 11 Desktop simulation
    static uint64_t s_mock_tick = 0;
    s_mock_tick++;

    const int W = screen_width_;
    const int H = screen_height_;

    auto DrawSolidRect = [](std::vector<uint8_t>& buf, int w_max, int h_max, int rx, int ry, int rw, int rh, uint8_t r, uint8_t g, uint8_t b) {
        int x0 = std::max(0, rx);
        int y0 = std::max(0, ry);
        int x1 = std::min(w_max, rx + rw);
        int y1 = std::min(h_max, ry + rh);
        for (int y = y0; y < y1; ++y) {
            for (int x = x0; x < x1; ++x) {
                int idx = (y * w_max + x) * 4;
                buf[idx + 0] = b;
                buf[idx + 1] = g;
                buf[idx + 2] = r;
                buf[idx + 3] = 255;
            }
        }
    };

    // 1. Wallpaper: Dark elegant slate blue gradient with soft radial bloom (cached for fast 30 FPS)
    static std::vector<uint8_t> s_mock_wallpaper;
    if (s_mock_wallpaper.size() != (size_t)W * H * 4) {
        s_mock_wallpaper.resize(W * H * 4);
        for (int y = 0; y < H; ++y) {
            float vy = (float)y / H;
            for (int x = 0; x < W; ++x) {
                float vx = (float)x / W;
                float dx = vx - 0.5f;
                float dy = vy - 0.45f;
                float dist = std::sqrt(dx * dx + dy * dy);
                float bloom = std::max(0.0f, 1.0f - dist * 1.5f);

                int r = (int)(18 + bloom * 30 + vy * 10);
                int g = (int)(24 + bloom * 45 + vy * 15);
                int b = (int)(45 + bloom * 80 + vy * 25);

                int idx = (y * W + x) * 4;
                s_mock_wallpaper[idx + 0] = (uint8_t)std::min(255, b);
                s_mock_wallpaper[idx + 1] = (uint8_t)std::min(255, g);
                s_mock_wallpaper[idx + 2] = (uint8_t)std::min(255, r);
                s_mock_wallpaper[idx + 3] = 255;
            }
        }
    }
    memcpy(out_frame.bgra_buffer.data(), s_mock_wallpaper.data(), (size_t)W * H * 4);

    // 2. Window: VS Code / IDE window in center (x: 280, y: 140, w: 1360, h: 800)
    int win_x = 280, win_y = 140, win_w = 1360, win_h = 800;
    // Window title bar
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x, win_y, win_w, 36, 40, 44, 52);
    // Window control buttons
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + win_w - 45, win_y, 45, 36, 232, 17, 35); // Close
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + win_w - 90, win_y, 45, 36, 60, 65, 75);  // Max
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + win_w - 135, win_y, 45, 36, 60, 65, 75); // Min
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + 16, win_y + 12, 180, 12, 160, 165, 180); // Title

    // Left activity bar
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x, win_y + 36, 48, win_h - 36 - 24, 30, 32, 38);
    for (int i = 0; i < 5; ++i) {
        DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + 14, win_y + 48 + i * 44, 20, 20, 120, 125, 140);
    }

    // Sidebar / Explorer
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + 48, win_y + 36, 220, win_h - 36 - 24, 25, 27, 33);
    for (int i = 0; i < 14; ++i) {
        int lw = 60 + (i * 37) % 100;
        DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + 64 + (i % 3) * 12, win_y + 54 + i * 26, lw, 10, 85, 90, 105);
    }

    // Main editor area
    int ed_x = win_x + 48 + 220;
    int ed_y = win_y + 36;
    int ed_w = win_w - (48 + 220);
    int ed_h = win_h - 36 - 24;
    DrawSolidRect(out_frame.bgra_buffer, W, H, ed_x, ed_y, ed_w, ed_h, 30, 30, 30);
    // Tab bar
    DrawSolidRect(out_frame.bgra_buffer, W, H, ed_x, ed_y, ed_w, 32, 37, 37, 38);
    DrawSolidRect(out_frame.bgra_buffer, W, H, ed_x, ed_y, 140, 32, 30, 30, 30); // active tab
    DrawSolidRect(out_frame.bgra_buffer, W, H, ed_x + 16, ed_y + 10, 90, 12, 180, 180, 190);

    // Code lines with syntax colors
    const uint8_t syntax_colors[][3] = {
        {86, 156, 214},  // Blue (keyword)
        {220, 220, 170}, // Yellow (function)
        {206, 145, 120}, // Orange/Peach (string)
        {106, 153, 85},  // Green (comment)
        {156, 220, 254}, // Light blue (variable)
        {212, 212, 212}  // Plain
    };
    int active_line_idx = (int)(s_mock_tick % 24);
    int active_cursor_x = ed_x + 24;
    for (int line = 0; line < 24; ++line) {
        int ly = ed_y + 44 + line * 24;
        int lx = ed_x + 24;
        // Line number
        DrawSolidRect(out_frame.bgra_buffer, W, H, lx, ly, 20, 10, 80, 85, 95);
        lx += 35;
        int indent = (line % 5 == 1 || line % 5 == 2) ? 24 : ((line % 5 == 3) ? 48 : 0);
        lx += indent;
        int num_tokens = 3 + (line * 7) % 5;
        for (int t = 0; t < num_tokens; ++t) {
            int tw = 25 + ((line * 13 + t * 29) % 70);
            int c_idx = (line + t) % 6;
            DrawSolidRect(out_frame.bgra_buffer, W, H, lx, ly, tw, 10, syntax_colors[c_idx][0], syntax_colors[c_idx][1], syntax_colors[c_idx][2]);
            lx += tw + 10;
        }
        if (line == active_line_idx) {
            active_cursor_x = lx + 4;
        }
    }

    // Blinking typing caret on active code line
    if ((s_mock_tick % 2) == 0) {
        int ly = ed_y + 44 + active_line_idx * 24;
        DrawSolidRect(out_frame.bgra_buffer, W, H, active_cursor_x, ly - 2, 2, 14, 255, 255, 255);
    }

    // Status bar at bottom of window
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x, win_y + win_h - 24, win_w, 24, 0, 122, 204);
    DrawSolidRect(out_frame.bgra_buffer, W, H, win_x + 16, win_y + win_h - 18, 120, 10, 255, 255, 255);

    // 3. Desktop Taskbar at bottom (y: H - 48, w: W, h: 48)
    int tb_y = H - 48;
    DrawSolidRect(out_frame.bgra_buffer, W, H, 0, tb_y, W, 48, 28, 33, 44);

    // Centered Windows 11 taskbar icons
    int icon_cx = W / 2 - 120;
    const uint8_t icon_colors[][3] = {
        {0, 120, 215},   // Start
        {100, 100, 110}, // Search
        {235, 175, 45},  // Explorer
        {0, 164, 239},   // Edge / Browser
        {0, 122, 204},   // VS Code
        {30, 30, 35},    // Terminal
    };
    for (int i = 0; i < 6; ++i) {
        DrawSolidRect(out_frame.bgra_buffer, W, H, icon_cx + i * 42, tb_y + 9, 30, 30, icon_colors[i][0], icon_colors[i][1], icon_colors[i][2]);
    }

    // System tray right corner
    DrawSolidRect(out_frame.bgra_buffer, W, H, W - 140, tb_y + 14, 60, 20, 180, 185, 195);
    DrawSolidRect(out_frame.bgra_buffer, W, H, W - 60, tb_y + 14, 40, 20, 180, 185, 195);

    // 4. Moving mouse pointer
    int cur_x = win_x + 400 + (int)(std::sin(s_mock_tick * 0.3f) * 200);
    int cur_y = win_y + 300 + (int)(std::cos(s_mock_tick * 0.2f) * 150);
    const int cursor_h = 18;
    const int cursor_w = 12;
    for (int dy = 0; dy < cursor_h; ++dy) {
        int row_w = std::max(1, cursor_w - dy / 2);
        for (int dx = 0; dx < row_w; ++dx) {
            int x = cur_x + dx;
            int y = cur_y + dy;
            if (x >= 0 && x < W && y >= 0 && y < H) {
                int idx = (y * W + x) * 4;
                bool is_border = (dx == 0 || dx == row_w - 1 || dy == 0 || dy == cursor_h - 1);
                if (is_border) {
                    out_frame.bgra_buffer[idx + 0] = 0;
                    out_frame.bgra_buffer[idx + 1] = 0;
                    out_frame.bgra_buffer[idx + 2] = 0;
                } else {
                    out_frame.bgra_buffer[idx + 0] = 255;
                    out_frame.bgra_buffer[idx + 1] = 255;
                    out_frame.bgra_buffer[idx + 2] = 255;
                }
            }
        }
    }

    frame_ready_ = true;
    last_success_timestamp_ms_ = Utils::GetCurrentTimestampMs();
    return true;
#endif
}

CaptureStatus ScreenCapturer::GetStatus() const {
    std::lock_guard<std::mutex> lock(capture_mutex_);
    return {initialized_, frame_ready_, last_success_timestamp_ms_};
}

bool ScreenCapturer::ReacquireDuplicationLocked() {
    ReleaseLocked();
    return InitializeLocked();
}

void ScreenCapturer::Release() {
    std::lock_guard<std::mutex> lock(capture_mutex_);
    ReleaseLocked();
}

void ScreenCapturer::ReleaseLocked() {
    initialized_ = false;
    frame_ready_ = false;
    screen_width_ = 0;
    screen_height_ = 0;
#ifdef _WIN32
    if (dxgi_dup_) {
        ((IDXGIOutputDuplication*)dxgi_dup_)->Release();
        dxgi_dup_ = nullptr;
    }
    if (staging_tex_) {
        ((ID3D11Texture2D*)staging_tex_)->Release();
        staging_tex_ = nullptr;
    }
    if (d3d_context_) {
        ((ID3D11DeviceContext*)d3d_context_)->Release();
        d3d_context_ = nullptr;
    }
    if (dxgi_device_) {
        ((ID3D11Device*)dxgi_device_)->Release();
        dxgi_device_ = nullptr;
    }
#endif
}

} // namespace GridSight
