#include <atomic>
#include <cassert>
#include <iostream>
#include <thread>
#include <vector>

#include "../include/capture.h"

namespace {
void AssertValidFrame(const GridSight::FrameData& frame) {
    assert(frame.width > 0);
    assert(frame.height > 0);
    assert(frame.pitch == frame.width * 4);
    assert(frame.bgra_buffer.size() ==
           static_cast<size_t>(frame.width) * frame.height * 4);
}
} // namespace

int main() {
    GridSight::ScreenCapturer capturer;

    // CaptureFrame must be able to initialize while it owns the capture lock.
    // Before the locked/unlocked lifecycle split this path self-deadlocked.
    GridSight::FrameData first;
    assert(capturer.CaptureFrame(first));
    AssertValidFrame(first);
    const auto first_status = capturer.GetStatus();
    assert(first_status.initialized);
    assert(first_status.frame_ready);
    assert(first_status.last_success_timestamp_ms > 0);

    // Release followed by lazy initialization exercises the same lifecycle used
    // after a DXGI duplication loss, without requiring Windows display faults.
    capturer.Release();
    const auto released_status = capturer.GetStatus();
    assert(!released_status.initialized);
    assert(!released_status.frame_ready);
    assert(released_status.last_success_timestamp_ms == first_status.last_success_timestamp_ms);

    GridSight::FrameData after_release;
    assert(capturer.CaptureFrame(after_release));
    AssertValidFrame(after_release);

    // Snapshot and focus-stream workers share one capturer. Concurrent callers
    // must remain serialized and both make forward progress.
    std::atomic<int> successful_captures{0};
    auto capture_once = [&]() {
        GridSight::FrameData frame;
        if (capturer.CaptureFrame(frame)) {
            AssertValidFrame(frame);
            successful_captures.fetch_add(1);
        }
    };

    std::thread snapshot_thread(capture_once);
    std::thread stream_thread(capture_once);
    snapshot_thread.join();
    stream_thread.join();

    assert(successful_captures.load() == 2);
    capturer.Release();

    std::cout << "ScreenCapturer lifecycle tests passed" << std::endl;
    return 0;
}
