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
    Utils::Log("INFO", "ScreenCapturer initialized DXGI: " + std::to_string(screen_width_) + "x" + std::to_string(screen_height_));
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
            // Screen is static; reuse previous staging texture frame
        } else {
            Utils::Log("ERROR", "DXGI AcquireNextFrame failed with HR: " + std::to_string(hr) + ". Reacquiring...");
            ReacquireDuplication();
            return false;
        }
    } else if (hr == S_OK && desktop_resource) {
        ID3D11Texture2D* desktop_tex = nullptr;
        hr = desktop_resource->QueryInterface(__uuidof(ID3D11Texture2D), (void**)&desktop_tex);
        if (SUCCEEDED(hr)) {
            context->CopyResource(staging_tex, desktop_tex);
            desktop_tex->Release();
        }
        desktop_resource->Release();
        dup->ReleaseFrame();
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
        return true;
    }

    return false;
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
