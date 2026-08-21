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
#include <shlobj.h>
#include <knownfolders.h>
#include <shellapi.h>
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

namespace GridSight {

#ifdef _WIN32
namespace {

std::string GetWindowsHostname() {
    char comp_name[MAX_COMPUTERNAME_LENGTH + 1] = {0};
    DWORD comp_name_len = sizeof(comp_name);
    if (GetComputerNameA(comp_name, &comp_name_len) && comp_name_len > 0) {
        return comp_name;
    }

    char host[256] = {0};
    DWORD host_len = sizeof(host);
    if (GetComputerNameExA(ComputerNamePhysicalDnsHostname, host, &host_len) && host_len > 0) {
        return host;
    }

    if (gethostname(host, sizeof(host)) == 0 && strlen(host) > 0) {
        return host;
    }

    return "DESKTOP-UNKNOWN";
}

std::string GetWindowsUsername() {
    char user[256] = {0};
    DWORD user_len = sizeof(user);
    if (GetUserNameA(user, &user_len) && user_len > 0) {
        return user;
    }
    return "Student";
}

void GetWindowsIpAndMac(std::string& ip, std::string& mac) {
    ULONG outBufLen = 15000;
    PIP_ADAPTER_ADDRESSES pAddresses = (IP_ADAPTER_ADDRESSES*)malloc(outBufLen);
    if (!pAddresses) {
        return;
    }

    if (GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, NULL, pAddresses, &outBufLen) == NO_ERROR) {
        for (PIP_ADAPTER_ADDRESSES pCurr = pAddresses; pCurr; pCurr = pCurr->Next) {
            if (pCurr->IfType == IF_TYPE_ETHERNET_CSMACD || pCurr->IfType == IF_TYPE_IEEE80211) {
                if (pCurr->OperStatus == IfOperStatusUp && pCurr->FirstUnicastAddress) {
                    sockaddr_in* sa_in = (sockaddr_in*)pCurr->FirstUnicastAddress->Address.lpSockaddr;
                    char ip_str[INET_ADDRSTRLEN];
                    inet_ntop(AF_INET, &(sa_in->sin_addr), ip_str, INET_ADDRSTRLEN);
                    if (strcmp(ip_str, "127.0.0.1") != 0) {
                        ip = ip_str;
                        char mac_buf[32];
                        snprintf(mac_buf, sizeof(mac_buf), "%02X:%02X:%02X:%02X:%02X:%02X",
                                 pCurr->PhysicalAddress[0], pCurr->PhysicalAddress[1],
                                 pCurr->PhysicalAddress[2], pCurr->PhysicalAddress[3],
                                 pCurr->PhysicalAddress[4], pCurr->PhysicalAddress[5]);
                        mac = mac_buf;
                        break;
                    }
                }
            }
        }
    }
    free(pAddresses);
}

} // anonymous namespace
#endif

NetworkInfo Utils::GetSystemNetworkInfo() {
    NetworkInfo info;
    info.ip = "127.0.0.1";
    info.mac = "00:00:00:00:00:00";
    info.hostname = "DESKTOP-UNKNOWN";
    info.username = "Student";

#ifdef _WIN32
    info.hostname = GetWindowsHostname();
    info.username = GetWindowsUsername();
    GetWindowsIpAndMac(info.ip, info.mac);
#endif
    return info;
}

#ifdef _WIN32
static uint64_t FileTimeToUint64(const FILETIME& ft) {
    return ((uint64_t)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
}
#endif

SystemHardwareInfo Utils::GetSystemHardwareInfo() {
    SystemHardwareInfo info;
    info.hostname = "PC-UNKNOWN";
    info.os_name = "Windows 11 (x64)";
    info.cpu_model = "Intel / AMD Processor";
    info.cpu_cores = 4;
    info.cpu_usage_percent = 5.0;
    info.ram_total_mb = 16384;
    info.ram_avail_mb = 11200;
    info.ram_usage_percent = 31.6;
    info.disk_drive = "C:";
    info.disk_total_gb = 512;
    info.disk_free_gb = 340;
    info.disk_usage_percent = 33.6;
    info.uptime_seconds = 3600;

#ifdef _WIN32
    char host[256] = {0};
    if (gethostname(host, sizeof(host)) == 0) {
        info.hostname = host;
    }

    // Read CPU Model from Registry
    char cpu_brand[128] = {0};
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_LOCAL_MACHINE, "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        DWORD size = sizeof(cpu_brand);
        RegQueryValueExA(hKey, "ProcessorNameString", NULL, NULL, (LPBYTE)cpu_brand, &size);
        RegCloseKey(hKey);
    }
    if (cpu_brand[0]) {
        info.cpu_model = cpu_brand;
        while (!info.cpu_model.empty() && (info.cpu_model.front() == ' ' || info.cpu_model.front() == '\t')) info.cpu_model.erase(0, 1);
        while (!info.cpu_model.empty() && (info.cpu_model.back() == ' ' || info.cpu_model.back() == '\t')) info.cpu_model.pop_back();
    }

    SYSTEM_INFO sysInfo;
    GetSystemInfo(&sysInfo);
    info.cpu_cores = (int)sysInfo.dwNumberOfProcessors;

    // CPU Usage via GetSystemTimes
    static FILETIME prev_idle = {0}, prev_kernel = {0}, prev_user = {0};
    static bool first_cpu = true;
    FILETIME idle, kernel, user;
    if (GetSystemTimes(&idle, &kernel, &user)) {
        if (!first_cpu) {
            uint64_t idle_diff = FileTimeToUint64(idle) - FileTimeToUint64(prev_idle);
            uint64_t kernel_diff = FileTimeToUint64(kernel) - FileTimeToUint64(prev_kernel);
            uint64_t user_diff = FileTimeToUint64(user) - FileTimeToUint64(prev_user);
            uint64_t total = kernel_diff + user_diff;
            if (total > 0 && total >= idle_diff) {
                info.cpu_usage_percent = (double)(total - idle_diff) * 100.0 / total;
            }
        }
        prev_idle = idle;
        prev_kernel = kernel;
        prev_user = user;
        first_cpu = false;
    }

    // RAM Status
    MEMORYSTATUSEX memInfo;
    memInfo.dwLength = sizeof(MEMORYSTATUSEX);
    if (GlobalMemoryStatusEx(&memInfo)) {
        info.ram_total_mb = memInfo.ullTotalPhys / (1024 * 1024);
        info.ram_avail_mb = memInfo.ullAvailPhys / (1024 * 1024);
        info.ram_usage_percent = (double)memInfo.dwMemoryLoad;
    }

    // Disk Status (C:)
    ULARGE_INTEGER freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes;
    if (GetDiskFreeSpaceExA("C:\\", &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)) {
        info.disk_total_gb = totalNumberOfBytes.QuadPart / (1024 * 1024 * 1024);
        info.disk_free_gb = totalNumberOfFreeBytes.QuadPart / (1024 * 1024 * 1024);
        if (info.disk_total_gb > 0) {
            uint64_t used_gb = info.disk_total_gb - info.disk_free_gb;
            info.disk_usage_percent = (double)used_gb * 100.0 / info.disk_total_gb;
        }
    }

    info.os_name = "Windows (x64)";
    info.uptime_seconds = (uint64_t)(GetTickCount64() / 1000);
#else
    char host[256] = {0};
    if (gethostname(host, sizeof(host)) == 0) {
        info.hostname = host;
    }
    info.os_name = "Linux";
    info.cpu_cores = (int)std::thread::hardware_concurrency();

    // Read CPU model from /proc/cpuinfo
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    while (std::getline(cpuinfo, line)) {
        if (line.find("model name") == 0) {
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                info.cpu_model = line.substr(colon + 2);
                break;
            }
        }
    }

    // Read RAM from /proc/meminfo
    std::ifstream meminfo("/proc/meminfo");
    uint64_t mem_total_kb = 0, mem_avail_kb = 0;
    while (std::getline(meminfo, line)) {
        if (line.find("MemTotal:") == 0) {
            std::istringstream ss(line.substr(9));
            ss >> mem_total_kb;
        } else if (line.find("MemAvailable:") == 0) {
            std::istringstream ss(line.substr(13));
            ss >> mem_avail_kb;
        }
    }
    if (mem_total_kb > 0) {
        info.ram_total_mb = mem_total_kb / 1024;
        info.ram_avail_mb = mem_avail_kb / 1024;
        info.ram_usage_percent = (double)(mem_total_kb - mem_avail_kb) * 100.0 / mem_total_kb;
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
    thread_local std::mt19937 generator(std::random_device{}());
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

std::string Utils::GetActiveWindowTitle() {
#ifdef _WIN32
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return "桌面 (Desktop)";

    wchar_t wtitle[256] = {0};
    int len = GetWindowTextW(hwnd, wtitle, 255);
    if (len <= 0) return "桌面 (Desktop)";

    // Convert UTF-16 wchar_t to UTF-8
    int utf8_len = WideCharToMultiByte(CP_UTF8, 0, wtitle, len, NULL, 0, NULL, NULL);
    if (utf8_len <= 0) return "桌面 (Desktop)";

    std::string utf8_title(utf8_len, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wtitle, len, &utf8_title[0], utf8_len, NULL, NULL);
    return utf8_title;
#else
    return "Visual Studio Code";
#endif
}

std::string Utils::ExtractJsonField(const std::string& json, const std::string& field_name) {
    std::string search_key = "\"" + field_name + "\"";
    size_t key_pos = json.find(search_key);
    if (key_pos == std::string::npos) return "";

    size_t colon_pos = json.find(':', key_pos + search_key.length());
    if (colon_pos == std::string::npos) return "";

    size_t quote_start = json.find('"', colon_pos + 1);
    if (quote_start == std::string::npos) return "";

    std::string result;
    bool escaped = false;
    for (size_t i = quote_start + 1; i < json.length(); ++i) {
        char c = json[i];
        if (escaped) {
            if (c == 'n') result += '\n';
            else if (c == 'r') result += '\r';
            else if (c == 't') result += '\t';
            else result += c;
            escaped = false;
        } else {
            if (c == '\\') {
                escaped = true;
            } else if (c == '"') {
                break;
            } else {
                result += c;
            }
        }
    }
    return result;
}

void Utils::OpenUrl(const std::string& url) {
    if (url.empty()) return;
    Log("INFO", "🔗 Opening URL in default browser: " + url);
#ifdef _WIN32
    int len = MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, NULL, 0);
    if (len > 0) {
        std::wstring wurl(len, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, &wurl[0], len);
        ShellExecuteW(NULL, L"open", wurl.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#else
    std::string cmd = "xdg-open \"" + url + "\" &";
    system(cmd.c_str());
#endif
}

bool Utils::DownloadAndOpenFile(const std::string& url, const std::string& raw_filename) {
    if (url.empty()) return false;

    std::string filename = raw_filename.empty() ? "downloaded_file" : raw_filename;

    std::string proto_prefix = "http://";
    std::string url_no_proto = url;
    if (url.find(proto_prefix) == 0) {
        url_no_proto = url.substr(proto_prefix.length());
    }

    size_t slash_pos = url_no_proto.find('/');
    std::string host_port = (slash_pos != std::string::npos) ? url_no_proto.substr(0, slash_pos) : url_no_proto;
    std::string path = (slash_pos != std::string::npos) ? url_no_proto.substr(slash_pos) : "/";

    std::string host = host_port;
    int port = 80;
    size_t colon_pos = host_port.find(':');
    if (colon_pos != std::string::npos) {
        host = host_port.substr(0, colon_pos);
        try {
            port = std::stoi(host_port.substr(colon_pos + 1));
        } catch (...) {
            port = 80;
        }
    }

#ifdef _WIN32
    std::wstring downloads_dir;
    PWSTR pPath = NULL;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Downloads, 0, NULL, &pPath))) {
        downloads_dir = pPath;
        CoTaskMemFree(pPath);
    } else {
        const wchar_t* userprofile = _wgetenv(L"USERPROFILE");
        if (userprofile) {
            downloads_dir = std::wstring(userprofile) + L"\\Downloads";
        } else {
            downloads_dir = L"C:\\Downloads";
        }
    }

    int wfn_len = MultiByteToWideChar(CP_UTF8, 0, filename.c_str(), -1, NULL, 0);
    std::wstring wfilename = L"downloaded_file";
    if (wfn_len > 0) {
        wfilename.resize(wfn_len - 1);
        MultiByteToWideChar(CP_UTF8, 0, filename.c_str(), -1, &wfilename[0], wfn_len);
    }

    std::wstring ext;
    std::wstring name_part = wfilename;
    size_t dot_pos = wfilename.find_last_of(L'.');
    if (dot_pos != std::wstring::npos) {
        name_part = wfilename.substr(0, dot_pos);
        ext = wfilename.substr(dot_pos);
    }

    std::wstring target_path = downloads_dir + L"\\" + wfilename;
    int counter = 1;
    while (GetFileAttributesW(target_path.c_str()) != INVALID_FILE_ATTRIBUTES) {
        target_path = downloads_dir + L"\\" + name_part + L" (" + std::to_wstring(counter) + L")" + ext;
        counter++;
    }

    int target_utf8_len = WideCharToMultiByte(CP_UTF8, 0, target_path.c_str(), -1, NULL, 0, NULL, NULL);
    std::string target_path_utf8;
    if (target_utf8_len > 0) {
        target_path_utf8.resize(target_utf8_len - 1);
        WideCharToMultiByte(CP_UTF8, 0, target_path.c_str(), -1, &target_path_utf8[0], target_utf8_len, NULL, NULL);
    }
#else
    std::string downloads_dir = "/tmp";
    const char* home = std::getenv("HOME");
    if (home) downloads_dir = std::string(home) + "/Downloads";
    std::string target_path_utf8 = downloads_dir + "/" + filename;
#endif

    Log("INFO", "📥 Downloading shared file from " + host + ":" + std::to_string(port) + path + " to " + target_path_utf8);

    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) {
        Log("ERROR", "Failed to create socket for downloading file");
        return false;
    }

#ifdef _WIN32
    DWORD timeout = 10000;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));
#else
    struct timeval timeout = { 10, 0 };
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
#endif

    sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

    if (connect(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        Log("ERROR", "Failed to connect to teacher server for file download");
        closesocket(s);
        return false;
    }

    std::ostringstream req;
    req << "GET " << path << " HTTP/1.1\r\n"
        << "Host: " << host << ":" << port << "\r\n"
        << "User-Agent: GridSight-Beacon\r\n"
        << "Connection: close\r\n\r\n";
    std::string req_str = req.str();
    send(s, req_str.c_str(), (int)req_str.length(), 0);

    std::ofstream outfile;
#ifdef _WIN32
    outfile.open(target_path.c_str(), std::ios::binary);
#else
    outfile.open(target_path_utf8.c_str(), std::ios::binary);
#endif

    if (!outfile.is_open()) {
        Log("ERROR", "Failed to open output file: " + target_path_utf8);
        closesocket(s);
        return false;
    }

    char buf[8192];
    bool header_parsed = false;
    std::string header_buf;
    size_t total_saved = 0;

    while (true) {
        int bytes = recv(s, buf, sizeof(buf), 0);
        if (bytes <= 0) break;

        if (!header_parsed) {
            header_buf.append(buf, bytes);
            size_t header_end = header_buf.find("\r\n\r\n");
            if (header_end != std::string::npos) {
                if (header_buf.find("200 OK") == std::string::npos && header_buf.find("HTTP/1.1 200") == std::string::npos && header_buf.find("HTTP/1.0 200") == std::string::npos) {
                    Log("ERROR", "Teacher server returned non-200 status for file download");
                    outfile.close();
                    closesocket(s);
                    return false;
                }

                header_parsed = true;
                size_t body_start = header_end + 4;
                if (body_start < header_buf.length()) {
                    outfile.write(header_buf.data() + body_start, header_buf.length() - body_start);
                    total_saved += (header_buf.length() - body_start);
                }
            }
        } else {
            outfile.write(buf, bytes);
            total_saved += bytes;
        }
    }

    outfile.close();
    closesocket(s);

    if (total_saved == 0) {
        Log("ERROR", "Downloaded file is empty (0 bytes)");
        return false;
    }

    Log("INFO", "✅ File successfully saved to Downloads directory (" + std::to_string(total_saved) + " bytes): " + target_path_utf8);

#ifdef _WIN32
    std::wstring params = L"/select,\"" + target_path + L"\"";
    ShellExecuteW(NULL, L"open", L"explorer.exe", params.c_str(), NULL, SW_SHOWNORMAL);
    Log("INFO", "📂 Opened File Explorer highlighting: " + target_path_utf8);
#else
    std::string cmd = "xdg-open \"" + downloads_dir + "\" &";
    system(cmd.c_str());
#endif

    return true;
}

} // namespace GridSight
