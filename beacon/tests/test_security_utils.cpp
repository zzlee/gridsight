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

    std::cout << "✅ All Utils security, token-grant, heartbeat, and logging tests passed!" << std::endl;
    return 0;
}
