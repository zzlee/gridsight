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

    std::cout << "✅ All Utils::OpenUrl Security Tests Passed!" << std::endl;
    return 0;
}
