#include <thread>
#include "../include/utils.h"
#include <iostream>
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>
#include <cstring>
#include <fstream>
#include <map>
#include <cstdlib>
#include <mutex>

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

static std::mutex g_log_mutex;
static std::ofstream g_log_file;
static bool g_log_initialized = false;

void Utils::Log(const std::string& level, const std::string& message) {
    std::lock_guard<std::mutex> lock(g_log_mutex);

    if (!g_log_initialized) {
        g_log_file.open("gs-agent.log", std::ios::app);
        g_log_initialized = true;
    }

    auto now = std::chrono::system_clock::now();
    std::time_t now_c = std::chrono::system_clock::to_time_t(now);
    std::tm now_tm;
#ifdef _WIN32
    localtime_s(&now_tm, &now_c);
#else
    localtime_r(&now_c, &now_tm);
#endif

    std::stringstream ss;
    ss << "[" << std::put_time(&now_tm, "%Y-%m-%d %H:%M:%S") << "] [" << level << "] " << message;

    std::cout << ss.str() << std::endl;
    if (g_log_file.is_open()) {
        g_log_file << ss.str() << std::endl;
        g_log_file.flush();

        // Log Rotation (e.g., 5MB limit)
        if (g_log_file.tellp() > 5 * 1024 * 1024) {
            g_log_file.close();
            std::remove("gs-agent.log.1");
            std::rename("gs-agent.log", "gs-agent.log.1");
            g_log_file.open("gs-agent.log", std::ios::app);
        }
    }
}

static std::map<std::string, std::string> g_env_vars;

void Utils::LoadEnv(const std::string& filepath) {
    std::ifstream file(filepath);
    if (!file.is_open()) {
        Log("INFO", "No " + filepath + " file found, using system env / defaults");
        return;
    }

    std::string line;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') continue;

        size_t delimiterPos = line.find('=');
        if (delimiterPos != std::string::npos) {
            std::string key = line.substr(0, delimiterPos);
            std::string value = line.substr(delimiterPos + 1);

            // Trim whitespace
            key.erase(key.find_last_not_of(" \n\r\t") + 1);
            key.erase(0, key.find_first_not_of(" \n\r\t"));
            value.erase(value.find_last_not_of(" \n\r\t") + 1);
            value.erase(0, value.find_first_not_of(" \n\r\t"));

            g_env_vars[key] = value;
        }
    }
}

std::string Utils::GetEnv(const std::string& key, const std::string& default_value) {
    if (g_env_vars.find(key) != g_env_vars.end()) {
        return g_env_vars[key];
    }

    // Fallback to system environment variable
    const char* val = std::getenv(key.c_str());
    if (val != nullptr) {
        return std::string(val);
    }

    return default_value;
}

int Utils::GetEnvInt(const std::string& key, int default_value) {
    std::string val = GetEnv(key);
    if (val.empty()) {
        return default_value;
    }
    try {
        return std::stoi(val);
    } catch (...) {
        return default_value;
    }
}

// Standard Base64 Encoding
std::string Utils::Base64Encode(const uint8_t* data, size_t len) {
    static const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string result;
    result.reserve(((len + 2) / 3) * 4);

    for (size_t i = 0; i < len; i += 3) {
        uint32_t octet_a = i < len ? data[i] : 0;
        uint32_t octet_b = (i + 1) < len ? data[i + 1] : 0;
        uint32_t octet_c = (i + 2) < len ? data[i + 2] : 0;
        uint32_t triple = (octet_a << 16) | (octet_b << 8) | octet_c;

        result.push_back(b64_table[(triple >> 18) & 0x3F]);
        result.push_back(b64_table[(triple >> 12) & 0x3F]);
        result.push_back((i + 1) < len ? b64_table[(triple >> 6) & 0x3F] : '=');
        result.push_back((i + 2) < len ? b64_table[triple & 0x3F] : '=');
    }
    return result;
}

// Standalone SHA-1 Implementation (RFC 3174)
static void SHA1_Transform(uint32_t state[5], const uint8_t buffer[64]) {
    uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];
    uint32_t w[80];

    for (int i = 0; i < 16; i++) {
        w[i] = (buffer[i * 4] << 24) | (buffer[i * 4 + 1] << 16) | (buffer[i * 4 + 2] << 8) | (buffer[i * 4 + 3]);
    }
    for (int i = 16; i < 80; i++) {
        uint32_t t = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
        w[i] = (t << 1) | (t >> 31);
    }

    for (int i = 0; i < 80; i++) {
        uint32_t f, k;
        if (i < 20) {
            f = (b & c) | ((~b) & d);
            k = 0x5A827999;
        } else if (i < 40) {
            f = b ^ c ^ d;
            k = 0x6ED9EBA1;
        } else if (i < 60) {
            f = (b & c) | (b & d) | (c & d);
            k = 0x8F1BBCDC;
        } else {
            f = b ^ c ^ d;
            k = 0xCA62C1D6;
        }
        uint32_t temp = ((a << 5) | (a >> 27)) + f + e + k + w[i];
        e = d;
        d = c;
        c = (b << 30) | (b >> 2);
        b = a;
        a = temp;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
}

std::string Utils::ComputeWebSocketAcceptKey(const std::string& client_key) {
    std::string combined = client_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    uint32_t state[5] = { 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0 };

    std::vector<uint8_t> msg(combined.begin(), combined.end());
    uint64_t bit_len = (uint64_t)msg.size() * 8;

    msg.push_back(0x80);
    while ((msg.size() % 64) != 56) {
        msg.push_back(0x00);
    }
    for (int i = 7; i >= 0; i--) {
        msg.push_back((uint8_t)((bit_len >> (i * 8)) & 0xFF));
    }

    for (size_t i = 0; i < msg.size(); i += 64) {
        SHA1_Transform(state, &msg[i]);
    }

    uint8_t digest[20];
    for (int i = 0; i < 5; i++) {
        digest[i * 4 + 0] = (uint8_t)((state[i] >> 24) & 0xFF);
        digest[i * 4 + 1] = (uint8_t)((state[i] >> 16) & 0xFF);
        digest[i * 4 + 2] = (uint8_t)((state[i] >> 8) & 0xFF);
        digest[i * 4 + 3] = (uint8_t)(state[i] & 0xFF);
    }

    return Base64Encode(digest, 20);
}

void Utils::UpdateHeartbeat() {
    std::ofstream hb_file("gs-heartbeat.txt", std::ios::trunc);
    if (hb_file.is_open()) {
        hb_file << GetCurrentTimestampMs();
        hb_file.close();
    }
}

uint64_t Utils::GetLastHeartbeat() {
    std::ifstream hb_file("gs-heartbeat.txt");
    if (!hb_file.is_open()) {
        return 0;
    }
    std::string line;
    if (std::getline(hb_file, line)) {
        try {
            return std::stoull(line);
        } catch (...) {
            return 0;
        }
    }
    return 0;
}

} // namespace GridSight
