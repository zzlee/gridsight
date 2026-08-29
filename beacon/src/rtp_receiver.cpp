#include "../include/rtp_receiver.h"
#include "../include/utils.h"
#include <iostream>
#include <cstdint>
#include <sstream>
#include <iomanip>
#include <vector>
#include <cstring>
#include <chrono>
#include <mutex>
#include <algorithm>
#include <limits>
#include <exception>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <wmcodecdsp.h>

static const GUID GS_CLSID_CMSH264DecoderMFT = {0x62ce7e72, 0x4c71, 0x4d20, {0xb1, 0x5d, 0x45, 0x28, 0x31, 0xa8, 0x7d, 0x9d}};
static const GUID GS_CODECAPI_AVLowLatencyMode = {0x9c27891a, 0xed7a, 0x40e1, {0x88, 0xe1, 0xb2, 0xe4, 0x5b, 0x30, 0x49, 0x11}};
static const GUID GS_MF_LOW_LATENCY = {0x9c51d740, 0xdc55, 0x4864, {0x9c, 0x41, 0x8b, 0xa4, 0x76, 0xa5, 0xa1, 0xb8}};


namespace {

struct RTPPacketView {
    const uint8_t* payload = nullptr;
    size_t payload_len = 0;

    uint16_t sequence = 0;
    uint32_t timestamp = 0;
    uint32_t ssrc = 0;

    bool marker = false;
    bool padding = false;
    bool extension = false;
};

static uint16_t ReadBE16(const uint8_t* p) {
    return (static_cast<uint16_t>(p[0]) << 8) |
           static_cast<uint16_t>(p[1]);
}

static uint32_t ReadBE32(const uint8_t* p) {
    return (static_cast<uint32_t>(p[0]) << 24) |
           (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8) |
           static_cast<uint32_t>(p[3]);
}

/*
 * RFC 3550 RTP fixed header:
 *
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 ...
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |V=2|P|X|  CC   |M|     PT      |       sequence number        |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |                           timestamp                           |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 *  |           synchronization source (SSRC) identifier           |
 *  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 */
static bool ParseRTPPacket(
    const uint8_t* data,
    size_t size,
    RTPPacketView& out)
{
    out = {};

    if (!data || size < 12) {
        return false;
    }

    const uint8_t version = (data[0] >> 6) & 0x03;
    if (version != 2) {
        return false;
    }

    const bool padding = (data[0] & 0x20) != 0;
    const bool extension = (data[0] & 0x10) != 0;
    const uint8_t csrc_count = data[0] & 0x0F;

    const bool marker = (data[1] & 0x80) != 0;

    size_t header_len = 12;

    // CSRC list
    const size_t csrc_bytes =
        static_cast<size_t>(csrc_count) * 4;

    if (header_len + csrc_bytes > size) {
        return false;
    }

    header_len += csrc_bytes;

    // Header extension:
    //
    //   16-bit profile
    //   16-bit length, measured in 32-bit words
    //   extension data
    //
    if (extension) {
        if (header_len + 4 > size) {
            return false;
        }

        const uint16_t extension_words =
            ReadBE16(data + header_len + 2);

        const size_t extension_bytes =
            static_cast<size_t>(extension_words) * 4;

        if (header_len + 4 + extension_bytes > size) {
            return false;
        }

        header_len += 4 + extension_bytes;
    }

    size_t payload_end = size;

    // RTP padding count is stored in the final byte.
    if (padding) {
        if (size == 0) {
            return false;
        }

        const uint8_t padding_len = data[size - 1];

        if (padding_len == 0 ||
            padding_len > size - header_len) {
            return false;
        }

        payload_end -= padding_len;
    }

    if (payload_end < header_len) {
        return false;
    }

    out.payload = data + header_len;
    out.payload_len = payload_end - header_len;

    out.sequence = ReadBE16(data + 2);
    out.timestamp = ReadBE32(data + 4);
    out.ssrc = ReadBE32(data + 8);
    out.marker = marker;
    out.padding = padding;
    out.extension = extension;

    return out.payload_len > 0;
}

} // anonymous namespace

namespace GridSight {

// Global shared frame buffer for presentation overlay
static std::mutex g_frame_mutex;
static std::vector<uint8_t> g_bgra_buffer;
static int g_frame_w = 0;
static int g_frame_h = 0;

class H264DecoderMFT {
public:
    H264DecoderMFT() {
        CoInitializeEx(NULL, COINIT_MULTITHREADED);
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
        InitDecoder();
    }

    ~H264DecoderMFT() {
        Cleanup();
        MFShutdown();
        CoUninitialize();
    }

    bool InitDecoder() {
        Cleanup();
        HRESULT hr = CoCreateInstance(GS_CLSID_CMSH264DecoderMFT, NULL, CLSCTX_INPROC_SERVER, IID_IMFTransform, (void**)&pDecoder_);
        if (FAILED(hr) || !pDecoder_) {
            Utils::Log("ERROR", "Failed to create CMSH264DecoderMFT: hr=" + std::to_string(hr));
            return false;
        }

        // Enable low latency decoding mode to eliminate buffering delay
        IMFAttributes* pAttributes = nullptr;
        if (SUCCEEDED(pDecoder_->GetAttributes(&pAttributes))) {
            pAttributes->SetUINT32(GS_MF_LOW_LATENCY, 1);
            pAttributes->SetUINT32(GS_CODECAPI_AVLowLatencyMode, 1);
            pAttributes->Release();
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

        // Set initial output type (prefer NV12 or RGB32)
        IMFMediaType* pOutputType = nullptr;
        for (DWORD i = 0; SUCCEEDED(pDecoder_->GetOutputAvailableType(0, i, &pOutputType)); ++i) {
            GUID subtype = {0};
            pOutputType->GetGUID(MF_MT_SUBTYPE, &subtype);
            if (subtype == MFVideoFormat_NV12 || subtype == MFVideoFormat_RGB32 || subtype == MFVideoFormat_YV12) {
                hr = pDecoder_->SetOutputType(0, pOutputType, 0);
                if (SUCCEEDED(hr)) {
                    Utils::Log("INFO", "✅ Initialized decoder output type: " + (subtype == MFVideoFormat_NV12 ? std::string("NV12") : (subtype == MFVideoFormat_RGB32 ? std::string("RGB32") : std::string("YV12"))));
                    pOutputType->Release();
                    break;
                }
            }
            pOutputType->Release();
        }

        pDecoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
        pDecoder_->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
        initialized_ = true;
        Utils::Log("INFO", "✅ Windows Media Foundation H.264 Video Decoder initialized (LowLatency Mode Enabled).");
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
            pSample->SetSampleTime(sample_time_);
            pSample->SetSampleDuration(333333); // 30 FPS in 100-ns units
            sample_time_ += 333333;
        } else {
            pBuffer->Release();
            return false;
        }

        static uint64_t g_feed_count = 0;
        g_feed_count++;
        if (g_feed_count <= 25 || g_feed_count % 300 == 0) {
            std::stringstream hex_preview;
            for (size_t i = 0; i < std::min((size_t)8, size); ++i) {
                hex_preview << std::hex << std::setw(2) << std::setfill('0') << (int)data[i] << " ";
            }
            Utils::Log("INFO", "📥 [Decoder Input #" + std::to_string(g_feed_count) + "] " + std::to_string(size) + " bytes (prefix: " + hex_preview.str() + ")");
        }

        hr = pDecoder_->ProcessInput(0, pSample, 0);
        if (hr == MF_E_NOTACCEPTING) {
            // Drain output first if decoder buffer is full
            MFT_OUTPUT_DATA_BUFFER tempBuffer = {0};
            DWORD tempStatus = 0;
            pDecoder_->ProcessOutput(0, 1, &tempBuffer, &tempStatus);
            if (tempBuffer.pSample) tempBuffer.pSample->Release();
            hr = pDecoder_->ProcessInput(0, pSample, 0);
        }
        if (FAILED(hr) && hr != MF_E_NOTACCEPTING) {
            Utils::Log("WARN", "⚠️ [Decoder ProcessInput Failed] hr=0x" + std::to_string((unsigned int)hr));
        }
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

            if (hr == MF_E_TRANSFORM_STREAM_CHANGE || hr == (HRESULT)0xC00D6D60 /* MF_E_TRANSFORM_TYPE_NOT_SET */) {
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
                // 0xC00D6D72 is MF_E_TRANSFORM_NEED_MORE_INPUT
                if (hr != (HRESULT)0xC00D6D72) {
                    static uint64_t last_out_err = 0;
                    uint64_t now_ms = Utils::GetCurrentTimestampMs();
                    if (now_ms - last_out_err > 3000) {
                        last_out_err = now_ms;
                        std::stringstream ss;
                        ss << std::hex << (unsigned int)hr;
                        Utils::Log("WARN", "⚠️ [Decoder ProcessOutput Status] hr=0x" + ss.str());
                    }
                }
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
                            int alloc_h = (int)h;
                            int display_h = (int)h;
                            if (display_h == 1088) {
                                display_h = 1080;
                            }
                            out_w = (int)w;
                            out_h = display_h;
                            out_bgra.resize((size_t)out_w * out_h * 4);

                            /*
                             * Derive the actual row stride from the
                             * decoded buffer length. MF may pad rows
                             * for alignment; assuming stride==width
                             * produces a skewed image.
                             */
                            int stride = 0;
                            if (alloc_h > 0 && curLen > 0) {
                                if (subtype == MFVideoFormat_RGB32) {
                                    stride = (int)(curLen / alloc_h);
                                } else {
                                    // NV12 / YV12: buffer = stride * h * 3/2
                                    stride = (int)(curLen * 2 / ((size_t)alloc_h * 3));
                                }
                            }
                            if (stride <= 0) {
                                stride = (subtype == MFVideoFormat_RGB32)
                                    ? (int)w * 4
                                    : (int)w;
                            }

                            if (subtype == MFVideoFormat_NV12) {
                                ConvertNV12ToBGRA(pRaw, (int)w, alloc_h, display_h, stride, out_bgra.data());
                                got_frame = true;
                            } else if (subtype == MFVideoFormat_RGB32) {
                                // Row-by-row copy respecting actual stride
                                for (int row = 0; row < display_h; ++row) {
                                    memcpy(
                                        out_bgra.data() + (size_t)row * out_w * 4,
                                        pRaw + (size_t)row * stride,
                                        (size_t)out_w * 4);
                                }
                                got_frame = true;
                            } else if (subtype == MFVideoFormat_YV12) {
                                ConvertYV12ToBGRA(pRaw, (int)w, display_h, stride, out_bgra.data());
                                got_frame = true;
                            } else {
                                Utils::Log("WARN", "⚠️ [Decoder] Unknown output subtype GUID");
                            }

                            static uint64_t g_ok_out = 0;
                            g_ok_out++;
                            if (g_ok_out <= 10 || g_ok_out % 90 == 0) {
                                Utils::Log("INFO", "🎉 [Decoder] Frame decoded #" + std::to_string(g_ok_out) + " (" + std::to_string(out_w) + "x" + std::to_string(out_h) + ", bytes=" + std::to_string(curLen) + ")");
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

            if (got_frame) {
                static uint64_t last_log_time = 0;
                uint64_t now = Utils::GetCurrentTimestampMs();
                if (now - last_log_time > 3000) {
                    last_log_time = now;
                    Utils::Log("INFO", "📺 [RTP Broadcast] Successfully decoded and rendering video frame (" + std::to_string(out_w) + "x" + std::to_string(out_h) + ")");
                }
                return true;
            }
        }

        return got_frame;
    }

private:
    IMFTransform* pDecoder_ = nullptr;
    bool initialized_ = false;
    LONGLONG sample_time_ = 0;

    static void ConvertNV12ToBGRA(const uint8_t* nv12, int width, int alloc_height, int render_height, int stride, uint8_t* bgra) {
        const uint8_t* y_plane = nv12;
        const uint8_t* uv_plane = nv12 + (size_t)stride * alloc_height;

        for (int j = 0; j < render_height; ++j) {
            const uint8_t* y_ptr = y_plane + j * stride;
            const uint8_t* uv_ptr = uv_plane + (j / 2) * stride;
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

    static void ConvertYV12ToBGRA(const uint8_t* yv12, int width, int height, int stride, uint8_t* bgra) {
        const uint8_t* y_plane = yv12;
        const uint8_t* v_plane = yv12 + (size_t)stride * height;
        const uint8_t* u_plane = v_plane + (size_t)(stride / 2) * (height / 2);

        for (int j = 0; j < height; ++j) {
            const uint8_t* y_ptr = y_plane + j * stride;
            const uint8_t* u_ptr = u_plane + (j / 2) * (stride / 2);
            const uint8_t* v_ptr = v_plane + (j / 2) * (stride / 2);
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
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, win_w, win_h, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
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

    case WM_PAINT:
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
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

} // namespace GridSight
#else
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

namespace GridSight {

#ifdef _WIN32
static RTPReceiver* g_rtp_receiver_instance = nullptr;
#endif

void RTPReceiver::RequestCloseOverlay() {
#ifdef _WIN32
    if (g_rtp_receiver_instance) {
        g_rtp_receiver_instance->last_stop_broadcast_time_ = Utils::GetCurrentTimestampMs();
        g_rtp_receiver_instance->CloseOverlayWindow();
    }
#endif
}

RTPReceiver::RTPReceiver(const std::string& multicast_ip, int port)
    : multicast_ip_(multicast_ip), port_(port) {}

RTPReceiver::~RTPReceiver() {
    Stop();
}

void RTPReceiver::AppendAccessUnitNAL(
    const uint8_t* nal,
    size_t size,
    bool is_idr) {
    if (!nal || size == 0) {
        return;
    }

    if (!access_unit_active_) {
        access_unit_buffer_.clear();
        access_unit_active_ = true;
        access_unit_has_idr_ = false;
        access_unit_corrupt_ = false;
    }

    // Annex-B start code + complete NAL unit.
    access_unit_buffer_.push_back(0x00);
    access_unit_buffer_.push_back(0x00);
    access_unit_buffer_.push_back(0x00);
    access_unit_buffer_.push_back(0x01);
    access_unit_buffer_.insert(
        access_unit_buffer_.end(), nal, nal + size);

    access_unit_has_idr_ =
        access_unit_has_idr_ || is_idr;
}

void RTPReceiver::FlushAccessUnit() {
    if (!access_unit_active_) {
        return;
    }

    if (access_unit_corrupt_) {
        Utils::Log(
            "WARN",
            "⚠️ [RTP AU] Dropping corrupt H.264 access unit");
        access_unit_buffer_.clear();
        access_unit_active_ = false;
        access_unit_has_idr_ = false;
        access_unit_corrupt_ = false;
        return;
    }

    if (access_unit_buffer_.empty()) {
        access_unit_active_ = false;
        access_unit_has_idr_ = false;
        return;
    }

    /*
     * A keyframe must carry SPS/PPS before the IDR NAL. This keeps
     * the decoder recoverable when it joins an already-running stream.
     */
    if (access_unit_has_idr_) {
        // cached_sps_pps is intentionally prepended by ReceiveLoop
        // through the local assembly path below.
    }

    RenderFrame(
        access_unit_buffer_.data(),
        access_unit_buffer_.size());

    access_unit_buffer_.clear();
    access_unit_active_ = false;
    access_unit_has_idr_ = false;
    access_unit_corrupt_ = false;
}

bool RTPReceiver::Start() {
    if (running_.exchange(true)) return socket_fd_.load() != 0;
#ifdef _WIN32
    g_rtp_receiver_instance = this;
#endif

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock == INVALID_SOCKET) {
        Utils::Log("ERROR", "RTPReceiver failed to create UDP socket");
        running_ = false;
        return false;
    }

    int reuse = 1;
#ifdef _WIN32
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    // The 1080p30 H.264 multicast stream is 4-8 Mbps (~475+ datagrams/sec at
    // pkt_size=1316 with bursts on keyframes). The Windows default UDP receive
    // buffer (~64KB) overflows before ReceiveLoop + decode can drain it, which
    // shows up as [RTP Gap/Loss] and dropped FU-A orphan fragments in the logs.
    // Enlarge the kernel buffer so bursty frames are queued instead of dropped.
    int rcvbuf = 4 * 1024 * 1024;
    setsockopt(sock, SOL_SOCKET, SO_RCVBUF, (const char*)&rcvbuf, sizeof(rcvbuf));
    DWORD timeout = 500;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    int rcvbuf = 4 * 1024 * 1024;
    setsockopt(sock, SOL_SOCKET, SO_RCVBUF, &rcvbuf, sizeof(rcvbuf));
    struct timeval tv = {0, 500000};
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
        running_ = false;
        return false;
    }

    in_addr multicast_addr;
    if (inet_pton(AF_INET, multicast_ip_.c_str(), &multicast_addr) != 1) {
        Utils::Log("ERROR", "RTPReceiver invalid multicast IPv4 address: " + multicast_ip_);
        closesocket(sock);
        running_ = false;
        return false;
    }

    bool joined = false;
    NetworkInfo net_info = Utils::GetSystemNetworkInfo();
    in_addr interface_addr;
    if (!net_info.ip.empty() && net_info.ip != "127.0.0.1" &&
        inet_pton(AF_INET, net_info.ip.c_str(), &interface_addr) == 1) {
        struct ip_mreq nic_membership;
        memset(&nic_membership, 0, sizeof(nic_membership));
        nic_membership.imr_multiaddr = multicast_addr;
        nic_membership.imr_interface = interface_addr;
        joined = setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP,
                            (char*)&nic_membership, sizeof(nic_membership)) != SOCKET_ERROR;
    }
    if (!joined) {
        struct ip_mreq any_membership;
        memset(&any_membership, 0, sizeof(any_membership));
        any_membership.imr_multiaddr = multicast_addr;
        any_membership.imr_interface.s_addr = INADDR_ANY;
        joined = setsockopt(sock, IPPROTO_IP, IP_ADD_MEMBERSHIP,
                            (char*)&any_membership, sizeof(any_membership)) != SOCKET_ERROR;
    }
    if (!joined) {
        Utils::Log("ERROR", "RTPReceiver failed to join IGMP multicast group " + multicast_ip_);
        closesocket(sock);
        running_ = false;
        return false;
    }

    socket_fd_.store((uintptr_t)sock);
    try {
        receive_thread_ = std::thread(&RTPReceiver::ReceiveLoop, this);
        decode_thread_ = std::thread(&RTPReceiver::DecodeThreadLoop, this);
    } catch (const std::exception& err) {
        uintptr_t owned_socket = socket_fd_.exchange(0);
        if (owned_socket != 0 && (SOCKET)owned_socket != INVALID_SOCKET) {
            closesocket((SOCKET)owned_socket);
        }
        running_ = false;
        // Wake the (possibly started) decode thread so it can observe stop.
        au_cv_.notify_all();
        if (decode_thread_.joinable()) decode_thread_.join();
        Utils::Log("ERROR", "RTPReceiver worker startup failed: " + std::string(err.what()));
        return false;
    }

    Utils::Log("INFO", "RTPReceiver listening on " + multicast_ip_ + ":" + std::to_string(port_) + " with IGMP membership active");
    return true;
}

void RTPReceiver::Stop() {
    if (!running_.exchange(false)) return;
#ifdef _WIN32
    g_rtp_receiver_instance = nullptr;
#endif

    uintptr_t owned_socket = socket_fd_.exchange(0);
    if (owned_socket != 0 && (SOCKET)owned_socket != INVALID_SOCKET) {
        closesocket((SOCKET)owned_socket);
    }
    // Wake the decode thread and wait for it to finish decoding any
    // currently-held access unit, so it never touches the decoder after
    // the MFT is released below.
    au_cv_.notify_all();
    if (receive_thread_.joinable()) receive_thread_.join();
    if (decode_thread_.joinable()) decode_thread_.join();

    rtp_stream_initialized_ = false;
    rtp_last_seq_ = 0;
    rtp_ssrc_ = 0;
    fua_active_ = false;
    fua_last_seq_ = 0;
    fua_timestamp_ = 0;
    fua_ssrc_ = 0;
    access_unit_buffer_.clear();
    access_unit_active_ = false;
    access_unit_has_idr_ = false;
    access_unit_corrupt_ = false;
    {
        std::lock_guard<std::mutex> lock(au_mutex_);
        pending_au_queue_.clear();
    }

    CloseOverlayWindow();
#ifdef _WIN32
    if (decoder_) {
        delete (H264DecoderMFT*)decoder_;
        decoder_ = nullptr;
    }
#endif
}

void RTPReceiver::EnqueueAU(std::vector<uint8_t> au) {
    {
        std::lock_guard<std::mutex> lock(au_mutex_);
        // Bound the queue so a decode that temporarily falls behind the
        // live stream cannot grow an unbounded backlog (which would turn
        // into ever-increasing display latency). When full, discard the
        // oldest frame instead.
        const size_t kMaxQueuedAUs = 8;
        while (pending_au_queue_.size() >= kMaxQueuedAUs) {
            pending_au_queue_.pop_front();
        }
        pending_au_queue_.push_back(std::move(au));
    }
    au_cv_.notify_one();
}

void RTPReceiver::DecodeThreadLoop() {
    while (true) {
        std::vector<uint8_t> au;
        {
            std::unique_lock<std::mutex> lock(au_mutex_);
            au_cv_.wait(lock, [&] {
                return !running_ || !pending_au_queue_.empty();
            });
            if (!running_ && pending_au_queue_.empty()) break;
            if (pending_au_queue_.empty()) continue;

            /*
             * Keep-live edge: if more than one complete access unit is
             * queued, the decoder has fallen behind the live stream.
             * Discard all but the newest so the presented frame tracks
             * the teacher's live screen instead of replaying an old
             * backlog (the source of visible delay and "jump back").
             */
            while (pending_au_queue_.size() > 1) {
                pending_au_queue_.pop_front();
            }
            au = std::move(pending_au_queue_.front());
            pending_au_queue_.pop_front();
        }

        RenderFrame(au.data(), au.size());
    }
}

void RTPReceiver::ReceiveLoop() {
    SOCKET sock = (SOCKET)socket_fd_.load();
    if (sock == INVALID_SOCKET || sock == 0) {
        Utils::Log("ERROR", "RTPReceiver worker started without a valid socket");
        return;
    }

    std::vector<uint8_t> rtp_buffer(65536);
    std::vector<uint8_t> fua_reassembly_buffer;
    std::vector<uint8_t> cached_sps_pps;
    uint64_t last_packet_time = 0;

    /*
     * Hot-path loss diagnostics are throttled to at most one line per
     * 500ms. During a loss storm the per-packet [RTP Gap/Loss] and
     * [RTP FU-A] Dropping orphan fragment logs would otherwise flood
     * hundreds of thousands of lines/second through the logger, whose
     * I/O then starves the very socket-drain loop that is dropping.
     */
    uint64_t last_gap_log_ms = 0;
    uint64_t last_orphan_log_ms = 0;

    /*
     * Time of the last packet that belonged to the currently
     * locked SSRC. Used to decide whether a different SSRC
     * should take over the stream (e.g. teacher console was
     * restarted and now broadcasts under a new SSRC).
     */
    uint64_t last_accepted_stream_time = 0;

    /* If we see no packets from the active SSRC for this long,
     * allow any new SSRC to claim the receiver. */
    constexpr uint64_t kStreamReacquireTimeoutMs = 5000;

    while (running_) {
        sockaddr_in from_addr;
        socklen_t from_len = sizeof(from_addr);
        int bytes = recvfrom(sock, (char*)rtp_buffer.data(), (int)rtp_buffer.size(), 0, (sockaddr*)&from_addr, &from_len);

        uint64_t now = Utils::GetCurrentTimestampMs();

    if (bytes > 0) {
        if (now - last_stop_broadcast_time_ < 3000) {
            continue;
        }
        RTPPacketView pkt;

        if (!ParseRTPPacket(
                rtp_buffer.data(),
                static_cast<size_t>(bytes),
                pkt)) {
            Utils::Log("WARN", "⚠️ [RTP] Invalid RTP packet dropped");
            continue;
        }

        static uint64_t g_pkt_count = 0;
        ++g_pkt_count;

        last_packet_time = now;
        Utils::UpdateHeartbeat("rtp-packet");

        if (!overlay_active_) {
            CreateFullScreenOverlayWindow();
        }

        /*
         * ------------------------------------------------------------
         * RTP stream identity
         * ------------------------------------------------------------
         *
         * A multicast socket may receive packets from multiple RTP
         * senders. Do not mix their sequence numbers or FU-A fragments.
         */
        if (!rtp_stream_initialized_) {
            rtp_stream_initialized_ = true;
            rtp_last_seq_ = pkt.sequence;
            rtp_ssrc_ = pkt.ssrc;

            Utils::Log(
                "INFO",
                "🎥 [RTP] New stream SSRC=" +
                std::to_string(rtp_ssrc_));
        } else if (pkt.ssrc != rtp_ssrc_) {
            const bool current_stream_stale =
                last_accepted_stream_time == 0 ||
                (now - last_accepted_stream_time >
                 kStreamReacquireTimeoutMs);

            if (current_stream_stale) {
                /*
                 * The previously locked sender is gone (broadcast
                 * restarted, console rebooted, ...). Re-lock onto
                 * the new SSRC with a FULL state reset so stale
                 * fragments/parameter sets from the old stream can
                 * never leak into decoding of the new one.
                 */
                Utils::Log(
                    "INFO",
                    "🎥 [RTP] Stream changed SSRC=" +
                    std::to_string(rtp_ssrc_) +
                    " -> " +
                    std::to_string(pkt.ssrc) +
                    "; performing full decoder state reset");

                rtp_last_seq_ = pkt.sequence;
                rtp_ssrc_ = pkt.ssrc;
                last_accepted_stream_time = now;

                fua_reassembly_buffer.clear();
                fua_active_ = false;
                fua_last_seq_ = 0;
                fua_timestamp_ = 0;
                fua_ssrc_ = 0;

                access_unit_buffer_.clear();
                access_unit_active_ = false;
                access_unit_has_idr_ = false;
                access_unit_corrupt_ = false;

                /* New sender MUST deliver its own SPS/PPS before
                 * any IDR can be decoded; dropping the old cache
                 * prevents mixing parameter sets across streams. */
                cached_sps_pps.clear();

                /* Continue processing this first packet below. */
            } else {
                Utils::Log(
                    "WARN",
                    "⚠️ [RTP] Ignoring packet from unexpected SSRC=" +
                    std::to_string(pkt.ssrc) +
                    ", active SSRC=" +
                    std::to_string(rtp_ssrc_));

                /*
                 * Never allow a different SSRC to contaminate an
                 * in-progress FU-A frame.
                 */
                fua_reassembly_buffer.clear();
                fua_active_ = false;

                continue;
            }
        }

        /*
         * ------------------------------------------------------------
         * Sequence number validation
         * ------------------------------------------------------------
         */
        const uint16_t expected_seq =
            static_cast<uint16_t>(rtp_last_seq_ + 1);

        const bool sequence_ok =
            (pkt.sequence == expected_seq);

        if (!sequence_ok) {
            /*
             * A packet loss means an FU-A frame can no longer be
             * reconstructed correctly.
             *
             * IMPORTANT:
             * Previously this was only logged and the broken FU-A
             * buffer was still decoded.
             */
            const int gap =
                static_cast<int16_t>(
                    static_cast<uint16_t>(pkt.sequence - expected_seq));

            if (now - last_gap_log_ms >= 500) {
                last_gap_log_ms = now;
                Utils::Log(
                    "WARN",
                    "⚠️ [RTP Gap/Loss] Expected seq=" +
                    std::to_string(expected_seq) +
                    ", got seq=" +
                    std::to_string(pkt.sequence) +
                    " (delta=" +
                    std::to_string(gap) +
                    ")");
            }
            /* Else: suppress the per-packet spam during a loss storm so
             * logger I/O does not starve the socket-drain loop. */

            fua_reassembly_buffer.clear();
            fua_active_ = false;
            access_unit_corrupt_ = access_unit_active_;
        }

        rtp_last_seq_ = pkt.sequence;
        last_accepted_stream_time = now;

        const uint8_t* payload = pkt.payload;
        const size_t payload_len = pkt.payload_len;

        if (payload_len == 0) {
            continue;
        }

        const uint8_t nal_unit_type = payload[0] & 0x1F;

        /*
         * ------------------------------------------------------------
         * FU-A
         * RFC 6184 section 5.8
         * ------------------------------------------------------------
         */
        if (nal_unit_type == 28) {
            if (payload_len < 2) {
                Utils::Log(
                    "WARN",
                    "⚠️ [RTP FU-A] Packet too short");
                continue;
            }

            const uint8_t fu_indicator = payload[0];
            const uint8_t fu_header = payload[1];

            const bool start_bit =
                (fu_header & 0x80) != 0;

            const bool end_bit =
                (fu_header & 0x40) != 0;

            const uint8_t original_nal_type =
                (fu_indicator & 0xE0) |
                (fu_header & 0x1F);

            const uint8_t inner_type =
                fu_header & 0x1F;

            /*
             * FU-A packets belonging to one NALU must have the
             * same timestamp and SSRC.
             */
            if (start_bit) {
                /*
                 * Start a brand-new fragmented NALU.
                 */
                fua_reassembly_buffer.clear();

                fua_reassembly_buffer.push_back(0x00);
                fua_reassembly_buffer.push_back(0x00);
                fua_reassembly_buffer.push_back(0x00);
                fua_reassembly_buffer.push_back(0x01);
                fua_reassembly_buffer.push_back(original_nal_type);

                fua_reassembly_buffer.insert(
                    fua_reassembly_buffer.end(),
                    payload + 2,
                    payload + payload_len);

                fua_active_ = true;
                fua_last_seq_ = pkt.sequence;
                fua_timestamp_ = pkt.timestamp;
                fua_ssrc_ = pkt.ssrc;

            } else {
                /*
                 * A non-START fragment is only valid when a
                 * corresponding START fragment is active.
                 */
                if (!fua_active_) {
                    if (now - last_orphan_log_ms >= 500) {
                        last_orphan_log_ms = now;
                        Utils::Log(
                            "WARN",
                            "⚠️ [RTP FU-A] Dropping orphan fragment");
                    }
                    continue;
                }

                /*
                 * Verify FU-A stream continuity.
                 */
                const uint16_t expected_fua_seq =
                    static_cast<uint16_t>(fua_last_seq_ + 1);

                if (pkt.sequence != expected_fua_seq) {
                    Utils::Log(
                        "WARN",
                        "⚠️ [RTP FU-A] Sequence discontinuity; "
                        "dropping fragmented NALU");

                    fua_reassembly_buffer.clear();
                    fua_active_ = false;
                    continue;
                }

                /*
                 * Timestamp must remain constant throughout one
                 * fragmented NALU.
                 */
                if (pkt.timestamp != fua_timestamp_ ||
                    pkt.ssrc != fua_ssrc_) {

                    Utils::Log(
                        "WARN",
                        "⚠️ [RTP FU-A] Timestamp/SSRC changed; "
                        "dropping fragmented NALU");

                    fua_reassembly_buffer.clear();
                    fua_active_ = false;
                    continue;
                }

                fua_reassembly_buffer.insert(
                    fua_reassembly_buffer.end(),
                    payload + 2,
                    payload + payload_len);

                fua_last_seq_ = pkt.sequence;
            }

            /*
             * END fragment completes the NALU.
             */
            if (end_bit && fua_active_) {
                if (g_pkt_count <= 25 ||
                    g_pkt_count % 300 == 0) {

                    std::string inner_name =
                        (inner_type == 5)
                            ? "IDR Keyframe"
                            : ((inner_type == 1)
                                ? "Non-IDR Slice"
                                : ("Type " +
                                   std::to_string(inner_type)));

                    Utils::Log(
                        "INFO",
                        "🧩 [RTP FU-A] Reassembled " +
                        inner_name +
                        " (" +
                        std::to_string(
                            fua_reassembly_buffer.size()) +
                        " bytes, seq=" +
                        std::to_string(pkt.sequence) +
                        ", marker=" +
                        (pkt.marker ? "1" : "0") +
                        ")");
                }

                /*
                 * fua_reassembly_buffer already contains an
                 * Annex-B start code and reconstructed NAL
                 * header. Append it to the current AU instead
                 * of decoding immediately.
                 */
                AppendAccessUnitNAL(
                    fua_reassembly_buffer.data() + 4,
                    fua_reassembly_buffer.size() - 4,
                    inner_type == 5);

                fua_reassembly_buffer.clear();
                fua_active_ = false;
            }

        /*
         * ------------------------------------------------------------
         * STAP-A
         * ------------------------------------------------------------
         */
        } else if (nal_unit_type == 24) {

            size_t offset = 1;
            std::vector<uint8_t> combined_annexb;

            if (g_pkt_count <= 25 ||
                g_pkt_count % 300 == 0) {

                Utils::Log(
                    "INFO",
                    "📦 [RTP STAP-A] Aggregation packet received "
                    "(len=" +
                    std::to_string(payload_len) +
                    ", seq=" +
                    std::to_string(pkt.sequence) +
                    ")");
            }

            while (offset + 2 <= payload_len) {
                const uint16_t nal_size =
                    ReadBE16(payload + offset);

                offset += 2;

                /*
                 * Reject malformed aggregation packets instead
                 * of silently accepting partial data.
                 */
                if (nal_size == 0 ||
                    offset + nal_size > payload_len) {

                    access_unit_corrupt_ = true;
                    Utils::Log(
                        "WARN",
                        "⚠️ [RTP STAP-A] Malformed aggregation packet");

                    combined_annexb.clear();
                    break;
                }

                const uint8_t inner_type =
                    payload[offset] & 0x1F;

                std::string tname =
                    (inner_type == 7)
                        ? "SPS"
                        : ((inner_type == 8)
                            ? "PPS"
                            : ("Type " +
                               std::to_string(inner_type)));

                if (g_pkt_count <= 25 ||
                    g_pkt_count % 300 == 0) {

                    Utils::Log(
                        "INFO",
                        "   └─ " +
                        tname +
                        " (" +
                        std::to_string(nal_size) +
                        " bytes)");
                }

                combined_annexb.push_back(0x00);
                combined_annexb.push_back(0x00);
                combined_annexb.push_back(0x00);
                combined_annexb.push_back(0x01);

                combined_annexb.insert(
                    combined_annexb.end(),
                    payload + offset,
                    payload + offset + nal_size);

                offset += nal_size;
            }

            if (!combined_annexb.empty()) {
                cached_sps_pps = std::move(combined_annexb);

                /*
                 * STAP-A may contain SPS/PPS and/or other NALs.
                 * Keep the complete aggregation in the AU as
                 * well, so decoder configuration and frame data
                 * retain their original RTP order.
                 */
                size_t cache_offset = 0;
                while (cache_offset + 4 <= cached_sps_pps.size()) {
                    size_t nal_start = cache_offset + 4;
                    size_t next = cached_sps_pps.size();
                    for (size_t i = nal_start; i + 4 <= cached_sps_pps.size(); ++i) {
                        if (cached_sps_pps[i] == 0x00 &&
                            cached_sps_pps[i + 1] == 0x00 &&
                            cached_sps_pps[i + 2] == 0x00 &&
                            cached_sps_pps[i + 3] == 0x01) {
                            next = i;
                            break;
                        }
                    }
                    if (nal_start < next) {
                        AppendAccessUnitNAL(
                            cached_sps_pps.data() + nal_start,
                            next - nal_start,
                            false);
                    }
                    if (next == cached_sps_pps.size()) {
                        break;
                    }
                    cache_offset = next;
                }
            }

        /*
         * ------------------------------------------------------------
         * Single NAL unit
         * ------------------------------------------------------------
         */
        } else if (nal_unit_type >= 1 &&
                   nal_unit_type <= 23) {

            std::string sname =
                (nal_unit_type == 5)
                    ? "IDR Keyframe"
                    : ((nal_unit_type == 1)
                        ? "Non-IDR Slice"
                        : ((nal_unit_type == 7)
                            ? "SPS"
                            : ((nal_unit_type == 8)
                                ? "PPS"
                                : ((nal_unit_type == 6)
                                    ? "SEI"
                                    : ("Type " +
                                       std::to_string(
                                           nal_unit_type))))));

            if (g_pkt_count <= 25 ||
                g_pkt_count % 300 == 0) {

                Utils::Log(
                    "INFO",
                    "📦 [RTP Single NAL] " +
                    sname +
                    " (" +
                    std::to_string(payload_len) +
                    " bytes, seq=" +
                    std::to_string(pkt.sequence) +
                    ", marker=" +
                    (pkt.marker ? "1" : "0") +
                    ")");
            }

            /*
             * Cache SPS/PPS independently when they arrive as
             * single NAL packets.
             */
            if (nal_unit_type == 7 || nal_unit_type == 8) {
                cached_sps_pps.clear();
                cached_sps_pps.push_back(0x00);
                cached_sps_pps.push_back(0x00);
                cached_sps_pps.push_back(0x00);
                cached_sps_pps.push_back(0x01);
                cached_sps_pps.insert(
                    cached_sps_pps.end(),
                    payload,
                    payload + payload_len);
            }

            AppendAccessUnitNAL(
                payload,
                payload_len,
                nal_unit_type == 5);
        }

        /*
         * RTP marker=1 terminates the current video frame/AU.
         * The AU is handed to the dedicated decode thread (via a bounded
         * queue) rather than decoded inline, so the receive loop never
         * blocks on the (comparatively slow) MFT decode. This keeps the
         * UDP socket drained (no kernel drops) and lets the decode thread
         * drop stale frames to stay at the live edge.
         */
        if (pkt.marker) {
            std::vector<uint8_t> au_to_decode;
            if (access_unit_has_idr_ &&
                !cached_sps_pps.empty()) {

                /*
                 * If SPS/PPS are not already present in this AU,
                 * prepend the cached parameter sets before IDR.
                 */
                au_to_decode = cached_sps_pps;
                au_to_decode.insert(
                    au_to_decode.end(),
                    access_unit_buffer_.begin(),
                    access_unit_buffer_.end());
            } else {
                au_to_decode = access_unit_buffer_;
            }

            if (access_unit_corrupt_) {
                Utils::Log(
                    "WARN",
                    "⚠️ [RTP AU] Dropping corrupt H.264 access unit");
            } else if (!au_to_decode.empty()) {
                EnqueueAU(std::move(au_to_decode));
            }

            /*
             * Reset the per-frame access-unit assembly state so the next
             * frame starts from an empty buffer. Without this the growing
             * buffer is never cleared (AppendAccessUnitNAL only clears it
             * when access_unit_active_ is false), so every subsequent frame
             * fed to the decoder accumulates ALL prior NALs — replaying from
             * the start and growing without bound (visibly "buffers, replays
             * from head, then keeps accumulating").
             */
            access_unit_buffer_.clear();
            access_unit_active_ = false;
            access_unit_has_idr_ = false;
            access_unit_corrupt_ = false;
        }

    } else {
        /*
         * Close overlay if no packets received for > 3.5s.
         */
        if (overlay_active_ &&
            (now - last_packet_time > 3500)) {

            CloseOverlayWindow();
        }

        /*
         * recvfrom timeout means no packet arrived. Do not flush
         * an incomplete AU here; wait for the next RTP marker or
         * timestamp boundary so a delayed fragment cannot create
         * a partial decode.
         */
    }
    }

    access_unit_buffer_.clear();
    access_unit_active_ = false;
    access_unit_has_idr_ = false;
    access_unit_corrupt_ = false;

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
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
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
        Utils::UpdateHeartbeat("rtp-decode");
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
