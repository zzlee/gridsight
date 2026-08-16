#include "../include/utils.h"
#include <iostream>
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>
#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#include <windows.h>
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ws2_32.lib")
#endif

namespace GridSight {

NetworkInfo Utils::GetSystemNetworkInfo() {
    NetworkInfo info;
    info.ip = "127.0.0.1";
    info.mac = "00:00:00:00:00:00";
    info.hostname = "DESKTOP-UNKNOWN";
    info.username = "Student";

#ifdef _WIN32
    char host[256] = {0};
    if (gethostname(host, sizeof(host)) == 0) {
        info.hostname = host;
    }

    char user[256] = {0};
    DWORD user_len = sizeof(user);
    if (GetUserNameA(user, &user_len)) {
        info.username = user;
    }

    // Get IP and MAC from GetAdaptersInfo / GetAdaptersAddresses
    ULONG outBufLen = 15000;
    PIP_ADAPTER_ADDRESSES pAddresses = (IP_ADAPTER_ADDRESSES*)malloc(outBufLen);
    if (pAddresses) {
        if (GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, NULL, pAddresses, &outBufLen) == NO_ERROR) {
            for (PIP_ADAPTER_ADDRESSES pCurr = pAddresses; pCurr; pCurr = pCurr->Next) {
                if (pCurr->IfType == IF_TYPE_ETHERNET_CSMACD || pCurr->IfType == IF_TYPE_IEEE80211) {
                    if (pCurr->OperStatus == IfOperStatusUp && pCurr->FirstUnicastAddress) {
                        sockaddr_in* sa_in = (sockaddr_in*)pCurr->FirstUnicastAddress->Address.lpSockaddr;
                        char ip_str[INET_ADDRSTRLEN];
                        inet_ntop(AF_INET, &(sa_in->sin_addr), ip_str, INET_ADDRSTRLEN);
                        if (strcmp(ip_str, "127.0.0.1") != 0) {
                            info.ip = ip_str;
                            char mac_buf[32];
                            snprintf(mac_buf, sizeof(mac_buf), "%02X:%02X:%02X:%02X:%02X:%02X",
                                     pCurr->PhysicalAddress[0], pCurr->PhysicalAddress[1],
                                     pCurr->PhysicalAddress[2], pCurr->PhysicalAddress[3],
                                     pCurr->PhysicalAddress[4], pCurr->PhysicalAddress[5]);
                            info.mac = mac_buf;
                            break;
                        }
                    }
                }
            }
        }
        free(pAddresses);
    }
#endif
    return info;
}

uint64_t Utils::GetCurrentTimestampMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

void Utils::EnableDPIAwareness() {
#ifdef _WIN32
    SetProcessDPIAware();
#endif
}

void Utils::SleepMs(uint32_t ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

std::string Utils::GenerateRandomToken(size_t length) {
    static const char charset[] =
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    std::random_device rd;
    std::mt19937 generator(rd());
    std::uniform_int_distribution<size_t> dist(0, sizeof(charset) - 2);

    std::string result;
    result.reserve(length);
    for (size_t i = 0; i < length; ++i) {
        result += charset[dist(generator)];
    }
    return result;
}

void Utils::Log(const std::string& level, const std::string& message) {
    std::cout << "[" << level << "] " << message << std::endl;
}

} // namespace GridSight
