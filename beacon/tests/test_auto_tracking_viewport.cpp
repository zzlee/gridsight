#include <iostream>
#include <cassert>
#include <cmath>
#include "../include/rtp_receiver.h"
#include "../include/utils.h"

int main() {
    std::cout << "Running Auto-Tracking Viewport Unit Tests..." << std::endl;

    GridSight::RTPReceiver receiver("239.255.42.100", 9000);

    // Test 1: Fit Mode (Option 3-A Toggle OFF)
    receiver.SetTrackingMode(false);
    assert(!receiver.IsTrackingMode());
    auto vp_fit = receiver.ComputeViewport(1280, 720, 1920, 1080);
    assert(!vp_fit.is_tracking_active);
    assert(vp_fit.dest_w == 1280);
    assert(vp_fit.dest_h == 720);
    assert(vp_fit.src_w == 1920);
    assert(vp_fit.src_h == 1080);
    std::cout << "✅ PASS: Fit Mode scales to aspect ratio correctly." << std::endl;

    // Test 2: Tracking Mode when window >= frame size (No crop needed)
    receiver.SetTrackingMode(true);
    assert(receiver.IsTrackingMode());
    auto vp_full = receiver.ComputeViewport(1920, 1080, 1920, 1080);
    assert(!vp_full.is_tracking_active);
    assert(vp_full.dest_w == 1920);
    assert(vp_full.dest_h == 1080);
    assert(vp_full.src_x == 0);
    assert(vp_full.src_y == 0);
    std::cout << "✅ PASS: Tracking Mode centers 1:1 when window >= frame size." << std::endl;

    // Test 3: Tracking Mode when window < frame size (1280x720 window, 1920x1080 frame)
    // Initially no mouse event -> defaults to frame center (960, 540)
    auto vp_track1 = receiver.ComputeViewport(1280, 720, 1920, 1080);
    assert(vp_track1.is_tracking_active);
    assert(vp_track1.dest_w == 1280);
    assert(vp_track1.dest_h == 720);
    assert(vp_track1.src_w == 1280);
    assert(vp_track1.src_h == 720);
    std::cout << "✅ PASS: Tracking Mode activates 1:1 crop when window < frame size." << std::endl;

    // Test 4: Deadzone behavior (60% central deadzone)
    // Send mouse event right at center: 50% (norm_x = 32768, norm_y = 32768)
    GridSight::InputRTPEvent ev_center;
    ev_center.event_type = GridSight::InputEventType::MouseMove;
    ev_center.norm_x = 32768; // 50%
    ev_center.norm_y = 32768; // 50%
    receiver.UpdateInputEvent(ev_center);

    // Let it settle
    for (int i = 0; i < 30; ++i) {
        receiver.ComputeViewport(1280, 720, 1920, 1080);
    }
    auto vp_center = receiver.ComputeViewport(1280, 720, 1920, 1080);
    int settled_src_x = vp_center.src_x;
    int settled_src_y = vp_center.src_y;

    // Move mouse slightly within deadzone (48% instead of 50%)
    GridSight::InputRTPEvent ev_small_move;
    ev_small_move.event_type = GridSight::InputEventType::MouseMove;
    ev_small_move.norm_x = 31457; // ~48%
    ev_small_move.norm_y = 31457; // ~48%
    receiver.UpdateInputEvent(ev_small_move);

    auto vp_deadzone = receiver.ComputeViewport(1280, 720, 1920, 1080);
    // Viewport should NOT move because it is inside central 60% deadzone!
    assert(abs(vp_deadzone.src_x - settled_src_x) <= 1);
    assert(abs(vp_deadzone.src_y - settled_src_y) <= 1);
    std::cout << "✅ PASS: 60% Central Deadzone keeps viewport completely still." << std::endl;

    // Test 5: Mouse moves far right (norm_x = 65000, ~99%)
    GridSight::InputRTPEvent ev_far_right;
    ev_far_right.event_type = GridSight::InputEventType::MouseMove;
    ev_far_right.norm_x = 65000;
    ev_far_right.norm_y = 32768;
    receiver.UpdateInputEvent(ev_far_right);

    // Advance 60 frames to allow spring damping to smoothly reach target
    for (int i = 0; i < 60; ++i) {
        receiver.ComputeViewport(1280, 720, 1920, 1080);
    }
    auto vp_right = receiver.ComputeViewport(1280, 720, 1920, 1080);
    assert(vp_right.src_x <= 640);
    assert(vp_right.src_x >= 550); // Should be near or at right edge clamp
    std::cout << "✅ PASS: Spring Damping smoothly tracks mouse and clamps at frame boundary (src_x=" << vp_right.src_x << ")." << std::endl;

    std::cout << "\n🎉 All Auto-Tracking Viewport tests passed successfully!" << std::endl;
    return 0;
}
