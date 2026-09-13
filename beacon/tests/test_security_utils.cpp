#include <iostream>
#include <cassert>
#include <string>
#include <vector>
#include <fstream>
#include "../include/utils.h"

int main() {
    std::cout << "Running Utils::OpenUrl Security Tests..." << std::endl;

    // Remove any leftover markers
    std::remove("/tmp/injected_test1");
    std::remove("/tmp/injected_test2");

    // Test malicious URLs containing command injection payloads or invalid schemes (should be rejected)
    std::vector<std::string> malicious_urls = {
        "",
        "file:///etc/passwd",
        "ftp://example.com",
        "http://example.com; touch /tmp/injected_test1",
        "http://example.com & touch /tmp/injected_test2",
        "http://example.com\ncat /etc/passwd",
        "http://example.com\r\ntouch /tmp/injected_test3",
        "gopher://example.com",
        "javascript:alert(1)",
        "cmd.exe /c calc.exe",
        "powershell.exe -c calc.exe"
    };

    for (const auto& url : malicious_urls) {
        GridSight::Utils::OpenUrl(url);
    }

    // Verify no injected files were created by shell command execution
    std::ifstream check1("/tmp/injected_test1");
    assert(!check1.is_open() && "Security test failed: /tmp/injected_test1 was created!");

    std::ifstream check2("/tmp/injected_test2");
    assert(!check2.is_open() && "Security test failed: /tmp/injected_test2 was created!");

    const std::string grant =
        R"({"type":"TOKEN_GRANT","token":"abc123","signature":"0123456789abcdef"})";
    assert(GridSight::Utils::ExtractJsonField(grant, "type") == "TOKEN_GRANT");
    assert(GridSight::Utils::ExtractJsonField(grant, "token") == "abc123");
    assert(GridSight::Utils::ExtractJsonField(grant, "signature") == "0123456789abcdef");
    assert(GridSight::Utils::ExtractJsonField(grant, "missing").empty());

    GridSight::Utils::UpdateHeartbeat("test-component");
    assert(GridSight::Utils::GetLastHeartbeat("test-component") > 0);
    std::remove("gs-heartbeat-test-component.txt");

    // Test Logging
    GridSight::Utils::Log("INFO", "Testing log output functionality");
    std::ifstream log_file("gs-agent.log");
    assert(log_file.is_open() && "Log file gs-agent.log should be created and accessible");
    std::string log_contents((std::istreambuf_iterator<char>(log_file)), std::istreambuf_iterator<char>());
    assert(log_contents.find("Testing log output functionality") != std::string::npos);

    // Test Base64 Encoding
    std::string sample = "Hello GridSight";
    std::string b64 = GridSight::Utils::Base64Encode((const uint8_t*)sample.data(), sample.size());
    assert(b64 == "SGVsbG8gR3JpZFNpZ2h0" && "Base64 encoding failed");

    // Test JsonEscape
    std::string unescaped = "Hello \"GridSight\"\\Test\nNewline";
    std::string escaped = GridSight::Utils::JsonEscape(unescaped);
    assert(escaped.find("\\\"GridSight\\\"") != std::string::npos && "JsonEscape quote failed");
    assert(escaped.find("\\n") != std::string::npos && "JsonEscape newline failed");

    // Test ScreenLock State Transitions
    assert(!GridSight::Utils::IsScreenLocked() && "Screen should be unlocked initially");
    GridSight::Utils::LockScreen("課堂專注模式");
    assert(GridSight::Utils::IsScreenLocked() && "Screen should be locked after LockScreen()");
    GridSight::Utils::UnlockScreen();
    assert(!GridSight::Utils::IsScreenLocked() && "Screen should be unlocked after UnlockScreen()");

    // Test Showcase Toast State Transitions
    assert(!GridSight::Utils::IsShowcaseActive() && "Showcase should be inactive initially");
    GridSight::Utils::SetShowcaseToast(true);
    assert(GridSight::Utils::IsShowcaseActive() && "Showcase should be active after SetShowcaseToast(true)");
    GridSight::Utils::SetShowcaseToast(false);
    assert(!GridSight::Utils::IsShowcaseActive() && "Showcase should be inactive after SetShowcaseToast(false)");

    // Test Student ID & Roll Call State
    GridSight::Utils::SetStudentId("B1103001");
    assert(GridSight::Utils::GetStudentId() == "B1103001" && "Student ID setter/getter failed");

    // Test Assignment State Transitions
    GridSight::Utils::HideAssignmentDropZone();
    assert(!GridSight::Utils::IsAssignmentActive() && "Assignment should be inactive after HideAssignmentDropZone()");

    std::cout << "✅ All Utils security, Base64, JSON, ScreenLock, Showcase, and StudentID tests passed!" << std::endl;
    return 0;
}
