#include <thread>
#include <atomic>
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
#include <cctype>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#include <windows.h>
#include <initguid.h>
#include <knownfolders.h>
#include <shlobj.h>
#include <shellapi.h>
#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "uuid.lib")
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
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
static std::chrono::steady_clock::time_point g_last_log_rotation_time;

static std::string GetLogFilePath() {
#ifdef _WIN32
    char temp_dir[MAX_PATH] = {0};
    if (GetTempPathA(MAX_PATH, temp_dir)) {
        return std::string(temp_dir) + "gs-agent.log";
    }
#endif
    return "gs-agent.log";
}

void Utils::Log(const std::string& level, const std::string& message) {
    std::lock_guard<std::mutex> lock(g_log_mutex);

    if (!g_log_initialized) {
        g_log_file.open(GetLogFilePath(), std::ios::app);
        g_log_initialized = true;
        g_last_log_rotation_time = std::chrono::steady_clock::now();
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

        // Log Rotation (5MB limit OR 1 hour time limit)
        auto now_steady = std::chrono::steady_clock::now();
        if (g_log_file.tellp() > 5 * 1024 * 1024 || (now_steady - g_last_log_rotation_time) >= std::chrono::hours(1)) {
            g_log_file.close();
            std::string main_log = GetLogFilePath();
            std::string rot_log = main_log + ".1";
            std::remove(rot_log.c_str());
            std::rename(main_log.c_str(), rot_log.c_str());
            g_log_file.open(main_log, std::ios::app);
            g_last_log_rotation_time = now_steady;
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

static std::string GetHeartbeatFilePath(const std::string& component) {
    std::string safe_component;
    for (char c : component) {
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_') {
            safe_component += c;
        }
    }
    if (safe_component.empty()) safe_component = "worker";
    const std::string filename = safe_component == "worker"
        ? "gs-heartbeat.txt"
        : "gs-heartbeat-" + safe_component + ".txt";
#ifdef _WIN32
    char temp_dir[MAX_PATH] = {0};
    if (GetTempPathA(MAX_PATH, temp_dir)) {
        return std::string(temp_dir) + filename;
    }
#endif
    return filename;
}

void Utils::UpdateHeartbeat(const std::string& component) {
    std::ofstream hb_file(GetHeartbeatFilePath(component), std::ios::trunc);
    if (hb_file.is_open()) {
        hb_file << GetCurrentTimestampMs();
        hb_file.close();
    }
}

uint64_t Utils::GetLastHeartbeat(const std::string& component) {
    std::ifstream hb_file(GetHeartbeatFilePath(component));
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

static bool IsValidHttpUrl(const std::string& url) {
    if (url.empty()) return false;
    for (char c : url) {
        if (c == '\0' || std::isspace(static_cast<unsigned char>(c))) return false;
    }
    std::string lower_prefix = url.substr(0, 8);
    for (char& c : lower_prefix) {
        c = (char)std::tolower((unsigned char)c);
    }
    if (lower_prefix.find("http://") == 0 || lower_prefix.find("https://") == 0) {
        return true;
    }
    return false;
}

void Utils::OpenUrl(const std::string& url) {
    if (!IsValidHttpUrl(url)) {
        Log("WARN", "Refusing to open invalid or non-HTTP/HTTPS URL: " + url);
        return;
    }
    Log("INFO", "🔗 Opening URL in default browser: " + url);
#ifdef _WIN32
    int len = MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, NULL, 0);
    if (len > 0) {
        std::wstring wurl(len, L'\0');
        MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, &wurl[0], len);
        ShellExecuteW(NULL, L"open", wurl.c_str(), NULL, NULL, SW_SHOWNORMAL);
    }
#else
    pid_t pid = fork();
    if (pid == 0) {
        // Child process: execute xdg-open directly without shell
        execlp("xdg-open", "xdg-open", url.c_str(), (char*)NULL);
        _exit(1);
    }
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

    sockaddr_in addr{};
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
    pid_t pid = fork();
    if (pid == 0) {
        // Child process: execute xdg-open directly without shell
        execlp("xdg-open", "xdg-open", downloads_dir.c_str(), (char*)NULL);
        _exit(1);
    }
#endif

    return true;
}

std::string Utils::JsonEscape(const std::string& input) {
    std::ostringstream ss;
    ss << "\"";
    for (char c : input) {
        if (c == '"') ss << "\\\"";
        else if (c == '\\') ss << "\\\\";
        else if (c == '\b') ss << "\\b";
        else if (c == '\f') ss << "\\f";
        else if (c == '\n') ss << "\\n";
        else if (c == '\r') ss << "\\r";
        else if (c == '\t') ss << "\\t";
        else if ((unsigned char)c >= 0x20) ss << c;
    }
    ss << "\"";
    return ss.str();
}

// ============================================================
// HMAC-SHA256 (RFC 2104 + RFC 6234) — standalone implementation
// ============================================================

static const uint32_t SHA256_K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

static inline uint32_t sha256_rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static void SHA256_Transform(uint32_t state[8], const uint8_t block[64]) {
    uint32_t a, b, c, d, e, f, g, h, t1, t2, w[64];
    for (int i = 0; i < 16; i++)
        w[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16) |
               ((uint32_t)block[i*4+2] << 8)  | (uint32_t)block[i*4+3];
    for (int i = 16; i < 64; i++) {
        w[i] = sha256_rotr(w[i-2],17) ^ sha256_rotr(w[i-2],19) ^ (w[i-2]>>10);
        w[i] += w[i-7] + (sha256_rotr(w[i-15],7) ^ sha256_rotr(w[i-15],18) ^ (w[i-15]>>3));
        w[i] += w[i-16];
    }
    a=state[0]; b=state[1]; c=state[2]; d=state[3];
    e=state[4]; f=state[5]; g=state[6]; h=state[7];
    for (int i = 0; i < 64; i++) {
        t1 = h + (sha256_rotr(e,6)^sha256_rotr(e,11)^sha256_rotr(e,25)) + ((e&f)^(~e&g)) + SHA256_K[i] + w[i];
        t2 = (sha256_rotr(a,2)^sha256_rotr(a,13)^sha256_rotr(a,22)) + ((a&b)^(a&c)^(b&c));
        h=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
    }
    state[0]+=a; state[1]+=b; state[2]+=c; state[3]+=d;
    state[4]+=e; state[5]+=f; state[6]+=g; state[7]+=h;
}

static void SHA256_Hash(const uint8_t* data, size_t len, uint8_t out[32]) {
    uint32_t state[8] = {
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
    };
    uint8_t block[64];
    size_t total = len;
    for (size_t i = 0; i + 64 <= len; i += 64) {
        memcpy(block, data + i, 64);
        SHA256_Transform(state, block);
    }
    size_t rem = len % 64;
    memset(block, 0, 64);
    if (rem > 0) memcpy(block, data + len - rem, rem);
    block[rem] = 0x80;
    if (rem >= 56) {
        SHA256_Transform(state, block);
        memset(block, 0, 64);
    }
    uint64_t bits = (uint64_t)total * 8;
    for (int i = 0; i < 8; i++) block[56+i] = (uint8_t)(bits >> (56 - i*8));
    SHA256_Transform(state, block);
    for (int i = 0; i < 8; i++) {
        out[i*4]   = (uint8_t)(state[i]>>24);
        out[i*4+1] = (uint8_t)(state[i]>>16);
        out[i*4+2] = (uint8_t)(state[i]>>8);
        out[i*4+3] = (uint8_t)(state[i]);
    }
}

// HMAC-SHA256 per RFC 2104
static std::vector<uint8_t> HMAC_SHA256(const uint8_t* key, size_t key_len,
                                         const uint8_t* data, size_t data_len) {
    uint8_t k_pad[64];
    uint8_t k_hash[32];
    if (key_len > 64) {
        SHA256_Hash(key, key_len, k_hash);
        memcpy(k_pad, k_hash, 32);
        memset(k_pad + 32, 0, 32);
    } else {
        memset(k_pad, 0, 64);
        memcpy(k_pad, key, key_len);
    }

    // Inner: SHA256(K XOR ipad || data)
    std::vector<uint8_t> inner(64 + data_len);
    for (int i = 0; i < 64; i++) inner[i] = k_pad[i] ^ 0x36;
    memcpy(inner.data() + 64, data, data_len);
    uint8_t inner_hash[32];
    SHA256_Hash(inner.data(), inner.size(), inner_hash);

    // Outer: SHA256(K XOR opad || inner_hash)
    std::vector<uint8_t> outer(64 + 32);
    for (int i = 0; i < 64; i++) outer[i] = k_pad[i] ^ 0x5C;
    memcpy(outer.data() + 64, inner_hash, 32);
    uint8_t result[32];
    SHA256_Hash(outer.data(), outer.size(), result);

    return std::vector<uint8_t>(result, result + 32);
}

// Constant-time comparison to prevent timing side-channel
static bool HMACEqual(const uint8_t* a, const uint8_t* b, size_t len) {
    volatile uint8_t diff = 0;
    for (size_t i = 0; i < len; i++) diff |= a[i] ^ b[i];
    return diff == 0;
}

std::string Utils::HMACSHA256Hex(const std::string& key, const std::string& data) {
    auto mac = HMAC_SHA256(
        reinterpret_cast<const uint8_t*>(key.data()), key.size(),
        reinterpret_cast<const uint8_t*>(data.data()), data.size());
    std::ostringstream ss;
    ss << std::hex << std::setfill('0');
    for (auto b : mac) ss << std::setw(2) << (int)b;
    return ss.str();
}

bool Utils::VerifyHMACSHA256(const std::string& key, const std::string& data, const std::string& expected_hex) {
    auto mac = HMAC_SHA256(
        reinterpret_cast<const uint8_t*>(key.data()), key.size(),
        reinterpret_cast<const uint8_t*>(data.data()), data.size());
    // Convert expected hex to bytes
    if (expected_hex.size() != 64) return false;
    uint8_t expected[32];
    for (int i = 0; i < 32; i++) {
        unsigned int byte;
        std::istringstream ss(expected_hex.substr(i*2, 2));
        ss >> std::hex >> byte;
        expected[i] = (uint8_t)byte;
    }
    return HMACEqual(mac.data(), expected, 32);
}

void Utils::ShutdownSystem() {
    Log("WARN", "⚡ [System Power] Executing computer shutdown...");
#ifdef _WIN32
    // 1. Enable SE_SHUTDOWN_NAME privilege
    HANDLE hToken;
    TOKEN_PRIVILEGES tkp;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &hToken)) {
        LookupPrivilegeValue(NULL, SE_SHUTDOWN_NAME, &tkp.Privileges[0].Luid);
        tkp.PrivilegeCount = 1;
        tkp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
        AdjustTokenPrivileges(hToken, FALSE, &tkp, 0, (PTOKEN_PRIVILEGES)NULL, 0);
        CloseHandle(hToken);
    }
    // 2. Call ExitWindowsEx
    ExitWindowsEx(EWX_SHUTDOWN | EWX_FORCE, SHTDN_REASON_MAJOR_OTHER | SHTDN_REASON_FLAG_PLANNED);
    // 3. Fallback to system shutdown command
    int res = std::system("shutdown /s /f /t 0");
    (void)res;
#else
    int res = std::system("shutdown -h now || sudo shutdown -h now");
    (void)res;
#endif
}

static std::atomic<bool> g_shutdown_cancelled{false};

#ifdef _WIN32
static std::atomic<bool> g_shutdown_window_active{false};
static std::atomic<int> g_remaining_shutdown_seconds{30};
static HWND g_shutdown_hwnd = NULL;

static LRESULT CALLBACK ShutdownWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE:
        g_shutdown_hwnd = hwnd;
        SetTimer(hwnd, 1, 1000, NULL);
        // Button ID 1001
        CreateWindowW(
            L"BUTTON", L"取消關機",
            WS_TABSTOP | WS_VISIBLE | WS_CHILD | BS_DEFPUSHBUTTON,
            180, 210, 160, 40,
            hwnd, (HMENU)1001, GetModuleHandle(NULL), NULL
        );
        return 0;

    case WM_TIMER:
        if (wParam == 1) {
            int sec = --g_remaining_shutdown_seconds;
            if (sec <= 0) {
                KillTimer(hwnd, 1);
                DestroyWindow(hwnd);
            } else {
                InvalidateRect(hwnd, NULL, FALSE);
            }
        }
        return 0;

    case WM_COMMAND:
        if (LOWORD(wParam) == 1001) {
            g_shutdown_cancelled = true;
            KillTimer(hwnd, 1);
            DestroyWindow(hwnd);
        }
        return 0;

    case WM_CLOSE:
        g_shutdown_cancelled = true;
        KillTimer(hwnd, 1);
        DestroyWindow(hwnd);
        return 0;

    case WM_ERASEBKGND:
        return 1; // Prevent flicker

    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);

        int client_w = rc.right - rc.left;
        int client_h = rc.bottom - rc.top;

        // Double buffering
        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, client_w, client_h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        // Dark Slate-900 background
        HBRUSH bgBrush = CreateSolidBrush(RGB(15, 23, 42));
        FillRect(memDC, &rc, bgBrush);
        DeleteObject(bgBrush);

        HPEN borderPen = CreatePen(PS_SOLID, 3, RGB(239, 68, 68)); // Rose-500
        HPEN oldPen = (HPEN)SelectObject(memDC, borderPen);
        HBRUSH oldBrush = (HBRUSH)SelectObject(memDC, GetStockObject(HOLLOW_BRUSH));
        Rectangle(memDC, 1, 1, client_w - 1, client_h - 1);
        SelectObject(memDC, oldBrush);
        SelectObject(memDC, oldPen);
        DeleteObject(borderPen);

        SetBkMode(memDC, TRANSPARENT);

        // Title Header
        SetTextColor(memDC, RGB(248, 113, 113)); // Rose-400
        HFONT hTitleFont = CreateFontW(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        if (!hTitleFont) hTitleFont = CreateFontW(22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        HFONT oldFont = (HFONT)SelectObject(memDC, hTitleFont);

        RECT titleRc = { 20, 16, client_w - 20, 50 };
        const wchar_t* wtitle = L"⚠️ GridSight 遠端關機通知";
        DrawTextW(memDC, wtitle, -1, &titleRc, DT_CENTER | DT_SINGLELINE);

        // Subtitle Text
        SetTextColor(memDC, RGB(226, 232, 240)); // Slate-200
        HFONT hSubFont = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                     DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        if (!hSubFont) hSubFont = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        SelectObject(memDC, hSubFont);

        RECT subRc = { 20, 52, client_w - 20, 76 };
        const wchar_t* wsub = L"教師端已發送關機指令，本機將於以下時間後自動關機：";
        DrawTextW(memDC, wsub, -1, &subRc, DT_CENTER | DT_SINGLELINE);

        // Big Countdown Number
        SetTextColor(memDC, RGB(239, 68, 68)); // Rose-500
        HFONT hTimerFont = CreateFontW(48, 0, 0, 0, FW_EXTRABOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        SelectObject(memDC, hTimerFont);

        RECT timerRc = { 20, 82, client_w - 20, 150 };
        int remaining = g_remaining_shutdown_seconds.load();
        if (remaining < 0) remaining = 0;
        std::wstring wtimer = std::to_wstring(remaining) + L" 秒";
        DrawTextW(memDC, wtimer.c_str(), -1, &timerRc, DT_CENTER | DT_SINGLELINE);

        // Hint Text
        SetTextColor(memDC, RGB(148, 163, 184)); // Slate-400
        SelectObject(memDC, hSubFont);
        RECT hintRc = { 20, 160, client_w - 20, 190 };
        const wchar_t* whint = L"提示：如需繼續使用或儲存檔案，請點擊下方 [取消關機]";
        DrawTextW(memDC, whint, -1, &hintRc, DT_CENTER | DT_SINGLELINE);

        SelectObject(memDC, oldFont);
        DeleteObject(hTitleFont);
        DeleteObject(hSubFont);
        DeleteObject(hTimerFont);

        BitBlt(hdc, 0, 0, client_w, client_h, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
#endif

void Utils::TriggerShutdownCountdown(int timeout_seconds) {
    if (timeout_seconds <= 0) timeout_seconds = 30;

#ifdef _WIN32
    if (g_shutdown_window_active.exchange(true)) {
        Log("WARN", "[Shutdown] Countdown window already active; updating timeout to " + std::to_string(timeout_seconds) + "s");
        g_remaining_shutdown_seconds = timeout_seconds;
        return;
    }

    g_shutdown_cancelled = false;
    g_remaining_shutdown_seconds = timeout_seconds;

    HINSTANCE hInstance = GetModuleHandle(NULL);
    WNDCLASSW wc = {0};
    wc.lpfnWndProc = ShutdownWndProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"GridSightShutdownClass";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassW(&wc);

    int screen_w = GetSystemMetrics(SM_CXSCREEN);
    int screen_h = GetSystemMetrics(SM_CYSCREEN);
    int win_w = 520;
    int win_h = 280;
    int x = (screen_w - win_w) / 2;
    int y = (screen_h - win_h) / 2;

    HWND hwnd = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
        L"GridSightShutdownClass",
        L"GridSight 遠端關機通知",
        WS_POPUP | WS_BORDER | WS_CAPTION | WS_SYSMENU,
        x, y, win_w, win_h,
        NULL, NULL, hInstance, NULL
    );

    if (hwnd) {
        ShowWindow(hwnd, SW_SHOW);
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        UpdateWindow(hwnd);

        MSG msg;
        while (GetMessageW(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    g_shutdown_window_active = false;

    if (g_shutdown_cancelled) {
        Log("INFO", "[Shutdown] Remote shutdown was cancelled by student user or teacher command.");
    } else {
        Log("WARN", "[Shutdown] Countdown expired without cancellation; triggering computer shutdown now.");
        ShutdownSystem();
    }
#else
    Log("WARN", "⚡ [Shutdown] Remote shutdown countdown started (" + std::to_string(timeout_seconds) + "s)...");
    for (int i = timeout_seconds; i > 0; --i) {
        if (g_shutdown_cancelled) break;
        SleepMs(1000);
    }
    if (g_shutdown_cancelled) {
        Log("INFO", "[Shutdown] Remote shutdown cancelled.");
    } else {
        Log("WARN", "⚡ [Shutdown] Countdown expired; executing system shutdown...");
        ShutdownSystem();
    }
#endif
}

void Utils::CancelShutdown() {
    g_shutdown_cancelled = true;
    Log("INFO", "🛑 [Shutdown] CancelShutdown executed; aborting active shutdown countdown.");
#ifdef _WIN32
    if (g_shutdown_hwnd && IsWindow(g_shutdown_hwnd)) {
        PostMessageW(g_shutdown_hwnd, WM_CLOSE, 0, 0);
    }
#endif
}

// === Screen Lockout and Showcase Toast States (Cross-platform) ===
static std::atomic<bool> g_screen_locked(false);
static std::mutex g_lock_mutex;
static std::string g_lock_display_message = "請看講台專心聽課";
static std::atomic<bool> g_showcase_toast_active(false);

#ifdef _WIN32
static HWND g_curtain_hwnd = NULL;
static HHOOK g_keyboard_hook = NULL;
static HWND g_showcase_hwnd = NULL;
static std::thread g_curtain_thread;
static std::thread g_showcase_thread;

// Low-level keyboard hook to intercept Win, Alt+Tab, Alt+Esc, Ctrl+Esc, Alt+F4
static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && g_screen_locked.load()) {
        KBDLLHOOKSTRUCT* pKbd = (KBDLLHOOKSTRUCT*)lParam;
        if (pKbd) {
            // Intercept Windows Keys (LWIN / RWIN)
            if (pKbd->vkCode == VK_LWIN || pKbd->vkCode == VK_RWIN) return 1;
            // Intercept Alt+Tab, Alt+Esc, Alt+F4
            if (pKbd->flags & LLKHF_ALTDOWN) {
                if (pKbd->vkCode == VK_TAB || pKbd->vkCode == VK_ESCAPE || pKbd->vkCode == VK_F4) return 1;
            }
            // Intercept Ctrl+Esc
            if (pKbd->vkCode == VK_ESCAPE && (GetAsyncKeyState(VK_CONTROL) & 0x8000)) return 1;
            // Intercept context menu key (VK_APPS)
            if (pKbd->vkCode == VK_APPS) return 1;
            // Swallow all keyboard input during lock
            return 1;
        }
    }
    return CallNextHookEx(g_keyboard_hook, nCode, wParam, lParam);
}

// Curtain Window Procedure
static LRESULT CALLBACK CurtainWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE: {
        SetTimer(hwnd, 1, 500, NULL);
        return 0;
    }
    case WM_TIMER: {
        if (wParam == 1) {
            if (!g_screen_locked.load()) {
                KillTimer(hwnd, 1);
                DestroyWindow(hwnd);
                return 0;
            }
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            if (GetForegroundWindow() != hwnd) {
                SetForegroundWindow(hwnd);
            }
        }
        return 0;
    }
    case WM_ACTIVATE:
    case WM_KILLFOCUS: {
        if (g_screen_locked.load()) {
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
            SetForegroundWindow(hwnd);
        }
        return 0;
    }
    case WM_LBUTTONDOWN:
    case WM_RBUTTONDOWN:
    case WM_MBUTTONDOWN:
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
        return 0; // Swallow all inputs
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT rc;
        GetClientRect(hwnd, &rc);
        int client_w = rc.right - rc.left;
        int client_h = rc.bottom - rc.top;

        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, client_w, client_h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        // Dark sci-fi blue background (Slate-950: RGB 11, 17, 32)
        HBRUSH bgBrush = CreateSolidBrush(RGB(11, 17, 32));
        FillRect(memDC, &rc, bgBrush);
        DeleteObject(bgBrush);

        SetBkMode(memDC, TRANSPARENT);

        int cx = client_w / 2;
        int cy = client_h / 2;

        // Draw stylized Golden Padlock Icon (Option 1-A)
        int lock_w = 72;
        int lock_h = 56;
        int lock_x = cx - lock_w / 2;
        int lock_y = cy - 130;

        // Shackle (U-shape arch)
        HPEN shacklePen = CreatePen(PS_SOLID, 8, RGB(250, 204, 21)); // Amber-400
        HPEN oldPen = (HPEN)SelectObject(memDC, shacklePen);
        HBRUSH nullBrush = (HBRUSH)GetStockObject(NULL_BRUSH);
        HBRUSH oldBrush = (HBRUSH)SelectObject(memDC, nullBrush);
        Arc(memDC, lock_x + 12, lock_y - 36, lock_x + lock_w - 12, lock_y + 28,
            lock_x + lock_w - 12, lock_y, lock_x + 12, lock_y);

        // Lock Body (Golden rounded box)
        HBRUSH lockBrush = CreateSolidBrush(RGB(234, 179, 8)); // Amber-500
        SelectObject(memDC, lockBrush);
        HPEN borderPen = CreatePen(PS_SOLID, 2, RGB(253, 224, 71)); // Amber-300
        SelectObject(memDC, borderPen);
        RoundRect(memDC, lock_x, lock_y, lock_x + lock_w, lock_y + lock_h, 14, 14);

        // Keyhole (Dark dot + slot)
        HBRUSH keyholeBrush = CreateSolidBrush(RGB(15, 23, 42)); // Slate-900
        SelectObject(memDC, keyholeBrush);
        SelectObject(memDC, GetStockObject(NULL_PEN));
        Ellipse(memDC, cx - 6, lock_y + 16, cx + 6, lock_y + 28);
        RECT slotRc = { cx - 3, lock_y + 24, cx + 3, lock_y + 38 };
        FillRect(memDC, &slotRc, keyholeBrush);

        SelectObject(memDC, oldPen);
        SelectObject(memDC, oldBrush);
        DeleteObject(shacklePen);
        DeleteObject(lockBrush);
        DeleteObject(borderPen);
        DeleteObject(keyholeBrush);

        // Teacher Prompt Message (Large bold white)
        SetTextColor(memDC, RGB(241, 245, 249)); // Slate-100
        HFONT hMsgFont = CreateFontW(36, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                     DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        if (!hMsgFont) hMsgFont = CreateFontW(36, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                             OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                             DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        HFONT oldFont = (HFONT)SelectObject(memDC, hMsgFont);

        std::string current_msg;
        {
            std::lock_guard<std::mutex> lock(g_lock_mutex);
            current_msg = g_lock_display_message.empty() ? "請看講台專心聽課" : g_lock_display_message;
        }
        std::wstring wmsg;
        int len = MultiByteToWideChar(CP_UTF8, 0, current_msg.c_str(), -1, NULL, 0);
        if (len > 0) {
            wmsg.resize(len - 1);
            MultiByteToWideChar(CP_UTF8, 0, current_msg.c_str(), -1, &wmsg[0], len);
        } else {
            wmsg = L"請看講台專心聽課";
        }

        RECT msgRc = { 40, cy - 30, client_w - 40, cy + 40 };
        DrawTextW(memDC, wmsg.c_str(), -1, &msgRc, DT_CENTER | DT_SINGLELINE);

        // Subtitle: Mode Description
        SetTextColor(memDC, RGB(148, 163, 184)); // Slate-400
        HFONT hSubFont = CreateFontW(18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                     DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        if (!hSubFont) hSubFont = CreateFontW(18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                             OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                             DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        SelectObject(memDC, hSubFont);

        RECT subRc = { 40, cy + 50, client_w - 40, cy + 80 };
        const wchar_t* wsub = L"🔒 GridSight 課堂專注模式・螢幕與鍵盤滑鼠已鎖定";
        DrawTextW(memDC, wsub, -1, &subRc, DT_CENTER | DT_SINGLELINE);

        // Footer Hint
        SetTextColor(memDC, RGB(100, 116, 139)); // Slate-500
        HFONT hFootFont = CreateFontW(14, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                      DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
        SelectObject(memDC, hFootFont);

        RECT footRc = { 40, cy + 95, client_w - 40, cy + 125 };
        const wchar_t* wfoot = L"請注意聽講，講解完畢後由教師端統一解除鎖定";
        DrawTextW(memDC, wfoot, -1, &footRc, DT_CENTER | DT_SINGLELINE);

        SelectObject(memDC, oldFont);
        DeleteObject(hMsgFont);
        DeleteObject(hSubFont);
        DeleteObject(hFootFont);

        BitBlt(hdc, 0, 0, client_w, client_h, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY: {
        KillTimer(hwnd, 1);
        g_curtain_hwnd = NULL;
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// Showcase Toast Window Procedure (Non-obstructive bottom-right card)
static LRESULT CALLBACK ShowcaseWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT rc;
        GetClientRect(hwnd, &rc);
        int w = rc.right - rc.left;
        int h = rc.bottom - rc.top;

        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, w, h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        // Dark card background (Slate-900)
        HBRUSH cardBrush = CreateSolidBrush(RGB(15, 23, 42));
        HPEN purpleBorder = CreatePen(PS_SOLID, 2, RGB(168, 85, 247)); // Purple-500
        HBRUSH oldB = (HBRUSH)SelectObject(memDC, cardBrush);
        HPEN oldP = (HPEN)SelectObject(memDC, purpleBorder);

        RoundRect(memDC, 1, 1, w - 1, h - 1, 12, 12);

        SetBkMode(memDC, TRANSPARENT);

        // Title: Showcase Status
        SetTextColor(memDC, RGB(243, 232, 255)); // Purple-100
        HFONT hTitleFont = CreateFontW(16, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        HFONT oldF = (HFONT)SelectObject(memDC, hTitleFont);
        RECT tRc = { 16, 10, w - 16, 30 };
        DrawTextW(memDC, L"💡 您的螢幕正在全班轉播展示中", -1, &tRc, DT_LEFT | DT_SINGLELINE);

        // Subtitle: Continue operating
        SetTextColor(memDC, RGB(192, 132, 252)); // Purple-400
        HFONT hSubFont = CreateFontW(12, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                     OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                     DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        SelectObject(memDC, hSubFont);
        RECT sRc = { 16, 31, w - 16, 48 };
        DrawTextW(memDC, L"全體同學正觀看您的操作，請正常進行示範", -1, &sRc, DT_LEFT | DT_SINGLELINE);

        SelectObject(memDC, oldF);
        SelectObject(memDC, oldB);
        SelectObject(memDC, oldP);
        DeleteObject(cardBrush);
        DeleteObject(purpleBorder);
        DeleteObject(hTitleFont);
        DeleteObject(hSubFont);

        BitBlt(hdc, 0, 0, w, h, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY: {
        g_showcase_hwnd = NULL;
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
#endif

void Utils::LockScreen(const std::string& message) {
    {
        std::lock_guard<std::mutex> lock(g_lock_mutex);
        if (!message.empty()) g_lock_display_message = message;
    }

    if (g_screen_locked.exchange(true)) {
        Log("INFO", "🔒 [ScreenLock] Screen is already locked; updated display message.");
#ifdef _WIN32
        if (g_curtain_hwnd && IsWindow(g_curtain_hwnd)) {
            InvalidateRect(g_curtain_hwnd, NULL, TRUE);
        }
#endif
        return;
    }

    Log("INFO", "🔒 [ScreenLock] Activating classroom screen & input lockout...");

#ifdef _WIN32
    if (g_curtain_thread.joinable()) {
        g_curtain_thread.join();
    }

    g_curtain_thread = std::thread([]() {
        HINSTANCE hInstance = GetModuleHandle(NULL);
        WNDCLASSW wc = {0};
        wc.lpfnWndProc = CurtainWndProc;
        wc.hInstance = hInstance;
        wc.lpszClassName = L"GridSightCurtainClass";
        wc.hCursor = LoadCursor(NULL, IDC_ARROW);
        RegisterClassW(&wc);

        int screen_w = GetSystemMetrics(SM_CXSCREEN);
        int screen_h = GetSystemMetrics(SM_CYSCREEN);

        HWND hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            L"GridSightCurtainClass",
            L"GridSight 課堂專注模式",
            WS_POPUP | WS_VISIBLE,
            0, 0, screen_w, screen_h,
            NULL, NULL, hInstance, NULL
        );

        if (hwnd) {
            g_curtain_hwnd = hwnd;
            // Install low-level keyboard hook
            g_keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, hInstance, 0);

            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, screen_w, screen_h, SWP_SHOWWINDOW);
            SetForegroundWindow(hwnd);
            UpdateWindow(hwnd);

            MSG msg;
            while (GetMessageW(&msg, NULL, 0, 0)) {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if (g_keyboard_hook) {
                UnhookWindowsHookEx(g_keyboard_hook);
                g_keyboard_hook = NULL;
            }
        }
    });
#endif
}

void Utils::UnlockScreen() {
    if (!g_screen_locked.exchange(false)) {
        return;
    }
    Log("INFO", "🔓 [ScreenLock] Unlocking screen and restoring student desktop.");
#ifdef _WIN32
    if (g_curtain_hwnd && IsWindow(g_curtain_hwnd)) {
        PostMessageW(g_curtain_hwnd, WM_CLOSE, 0, 0);
    }
#endif
}

bool Utils::IsScreenLocked() {
    return g_screen_locked.load();
}

void Utils::SetShowcaseToast(bool active) {
    if (g_showcase_toast_active.exchange(active) == active) {
        return;
    }

    Log("INFO", active ? "💡 [Showcase] Showing bottom-right showcase toast." : "💡 [Showcase] Hiding showcase toast.");

#ifdef _WIN32
    if (active) {
        if (g_showcase_thread.joinable()) {
            g_showcase_thread.join();
        }

        g_showcase_thread = std::thread([]() {
            HINSTANCE hInstance = GetModuleHandle(NULL);
            WNDCLASSW wc = {0};
            wc.lpfnWndProc = ShowcaseWndProc;
            wc.hInstance = hInstance;
            wc.lpszClassName = L"GridSightShowcaseClass";
            wc.hCursor = LoadCursor(NULL, IDC_ARROW);
            RegisterClassW(&wc);

            int screen_w = GetSystemMetrics(SM_CXSCREEN);
            int screen_h = GetSystemMetrics(SM_CYSCREEN);
            int w = 340;
            int h = 60;
            int x = screen_w - w - 24;
            int y = screen_h - h - 48; // Near bottom-right corner

            HWND hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                L"GridSightShowcaseClass",
                L"GridSight Showcase",
                WS_POPUP | WS_VISIBLE,
                x, y, w, h,
                NULL, NULL, hInstance, NULL
            );

            if (hwnd) {
                g_showcase_hwnd = hwnd;
                SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_SHOWWINDOW | SWP_NOACTIVATE);
                UpdateWindow(hwnd);

                MSG msg;
                while (g_showcase_toast_active.load() && GetMessageW(&msg, NULL, 0, 0)) {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                if (IsWindow(hwnd)) {
                    DestroyWindow(hwnd);
                }
            }
        });
    } else {
        if (g_showcase_hwnd && IsWindow(g_showcase_hwnd)) {
            PostMessageW(g_showcase_hwnd, WM_CLOSE, 0, 0);
        }
    }
#endif
}

bool Utils::IsShowcaseActive() {
    return g_showcase_toast_active.load();
}

// --- Assignment Drop Zone (Feature 2) ---
struct AssignmentConfig {
    std::string id;
    std::string title;
    std::string allowed_exts;
    int max_size_mb = 50;
    std::string upload_url;
    std::string token;
};

static std::atomic<bool> g_assignment_active{false};
static std::mutex g_assignment_mutex;
static AssignmentConfig g_assignment_config;

#ifdef _WIN32
static std::wstring g_assignment_status_text = L"請將作業檔案拖曳至此處放開即可繳交";
static COLORREF g_assignment_status_color = RGB(56, 189, 248); // Sky-400
static bool g_assignment_uploading = false;
static HWND g_assignment_hwnd = NULL;
static std::thread g_assignment_thread;

static void PerformAssignmentUpload(const std::wstring& filePath, HWND hwnd) {
    g_assignment_uploading = true;
    size_t lastSlash = filePath.find_last_of(L"\\/");
    std::wstring wFilename = (lastSlash != std::wstring::npos) ? filePath.substr(lastSlash + 1) : filePath;

    // Convert filename to UTF-8
    int fnLen = WideCharToMultiByte(CP_UTF8, 0, wFilename.c_str(), -1, NULL, 0, NULL, NULL);
    std::string filenameUtf8;
    if (fnLen > 0) {
        filenameUtf8.resize(fnLen - 1);
        WideCharToMultiByte(CP_UTF8, 0, wFilename.c_str(), -1, &filenameUtf8[0], fnLen, NULL, NULL);
    }

    g_assignment_status_text = L"⏳ 正在上傳：" + wFilename + L"...";
    g_assignment_status_color = RGB(245, 158, 11); // Amber-500
    if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);

    AssignmentConfig config;
    {
        std::lock_guard<std::mutex> lock(g_assignment_mutex);
        config = g_assignment_config;
    }

    // Check allowed extensions
    if (!config.allowed_exts.empty() && config.allowed_exts != "*") {
        size_t dotPos = filenameUtf8.find_last_of('.');
        std::string ext = (dotPos != std::string::npos) ? filenameUtf8.substr(dotPos + 1) : "";
        for (char& c : ext) c = (char)tolower((unsigned char)c);

        bool allowed = false;
        std::stringstream ss(config.allowed_exts);
        std::string tok;
        while (std::getline(ss, tok, ',')) {
            while (!tok.empty() && isspace((unsigned char)tok.front())) tok.erase(tok.begin());
            while (!tok.empty() && isspace((unsigned char)tok.back())) tok.pop_back();
            if (!tok.empty() && tok.front() == '.') tok.erase(tok.begin());
            for (char& c : tok) c = (char)tolower((unsigned char)c);
            if (tok == ext || tok == "*") {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            g_assignment_uploading = false;
            g_assignment_status_text = L"❌ 格式不符 (僅限: " + std::wstring(config.allowed_exts.begin(), config.allowed_exts.end()) + L")";
            g_assignment_status_color = RGB(239, 68, 68);
            if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
            MessageBeep(MB_ICONHAND);
            return;
        }
    }

    // Open file
    HANDLE hFile = CreateFileW(filePath.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        g_assignment_uploading = false;
        g_assignment_status_text = L"❌ 無法讀取該檔案";
        g_assignment_status_color = RGB(239, 68, 68);
        if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        MessageBeep(MB_ICONHAND);
        return;
    }

    LARGE_INTEGER liSize;
    if (!GetFileSizeEx(hFile, &liSize)) {
        CloseHandle(hFile);
        g_assignment_uploading = false;
        g_assignment_status_text = L"❌ 無法讀取檔案大小";
        g_assignment_status_color = RGB(239, 68, 68);
        if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        return;
    }
    int64_t fileSize = liSize.QuadPart;
    if (fileSize > (int64_t)config.max_size_mb * 1024 * 1024) {
        CloseHandle(hFile);
        g_assignment_uploading = false;
        g_assignment_status_text = L"❌ 檔案超過大小上限 (" + std::to_wstring(config.max_size_mb) + L" MB)";
        g_assignment_status_color = RGB(239, 68, 68);
        if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        MessageBeep(MB_ICONHAND);
        return;
    }

    // Parse URL
    std::string uploadUrl = config.upload_url;
    std::string proto = "http://";
    if (uploadUrl.find(proto) == 0) uploadUrl = uploadUrl.substr(proto.length());
    size_t slashPos = uploadUrl.find('/');
    std::string hostPort = (slashPos != std::string::npos) ? uploadUrl.substr(0, slashPos) : uploadUrl;
    std::string reqPath = (slashPos != std::string::npos) ? uploadUrl.substr(slashPos) : "/api/assignments/upload";
    std::string host = hostPort;
    int port = 3000;
    size_t colonPos = hostPort.find(':');
    if (colonPos != std::string::npos) {
        host = hostPort.substr(0, colonPos);
        try { port = std::stoi(hostPort.substr(colonPos + 1)); } catch(...) {}
    }

    SOCKET s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == INVALID_SOCKET) {
        CloseHandle(hFile);
        g_assignment_uploading = false;
        g_assignment_status_text = L"❌ 網路連線建立失敗";
        g_assignment_status_color = RGB(239, 68, 68);
        if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        return;
    }

    DWORD to = 30000;
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&to, sizeof(to));
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&to, sizeof(to));

    sockaddr_in addr = {0};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, host.c_str(), &addr.sin_addr);

    if (connect(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        closesocket(s);
        CloseHandle(hFile);
        g_assignment_uploading = false;
        g_assignment_status_text = L"❌ 無法連線至教師端伺服器";
        g_assignment_status_color = RGB(239, 68, 68);
        if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
        return;
    }

    NetworkInfo net = Utils::GetSystemNetworkInfo();
    std::string fn_b64 = Utils::Base64Encode((const uint8_t*)filenameUtf8.data(), filenameUtf8.size());

    std::ostringstream oss;
    oss << "POST " << reqPath << " HTTP/1.1\r\n"
        << "Host: " << host << ":" << port << "\r\n"
        << "X-Agent-MAC: " << net.mac << "\r\n"
        << "X-Agent-IP: " << net.ip << "\r\n"
        << "X-Auth-Token: " << config.token << "\r\n"
        << "X-Assignment-Id: " << config.id << "\r\n"
        << "X-Filename: " << fn_b64 << "\r\n"
        << "Content-Type: application/octet-stream\r\n"
        << "Content-Length: " << fileSize << "\r\n"
        << "Connection: close\r\n\r\n";
    std::string headers = oss.str();
    send(s, headers.c_str(), (int)headers.size(), 0);

    char buf[65536];
    DWORD bytesRead = 0;
    while (ReadFile(hFile, buf, sizeof(buf), &bytesRead, NULL) && bytesRead > 0) {
        int sent = send(s, buf, (int)bytesRead, 0);
        if (sent <= 0) break;
    }
    CloseHandle(hFile);

    char respBuf[512] = {0};
    int rec = recv(s, respBuf, sizeof(respBuf) - 1, 0);
    closesocket(s);

    g_assignment_uploading = false;
    if (rec > 0) {
        std::string resp(respBuf, rec);
        if (resp.find(" 200 ") != std::string::npos) {
            int kb = (int)(fileSize / 1024);
            g_assignment_status_text = L"✅ 繳交成功！" + wFilename + L" (" + std::to_wstring(kb) + L" KB)";
            g_assignment_status_color = RGB(34, 197, 94); // Emerald-500
            if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
            MessageBeep(MB_ICONASTERISK);
            return;
        }
    }

    g_assignment_status_text = L"❌ 伺服器接收失敗或格式錯誤";
    g_assignment_status_color = RGB(239, 68, 68);
    if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, NULL, TRUE);
    MessageBeep(MB_ICONHAND);
}

static LRESULT CALLBACK AssignmentDropWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_CREATE: {
        DragAcceptFiles(hwnd, TRUE);
        return 0;
    }
    case WM_DROPFILES: {
        HDROP hDrop = (HDROP)wParam;
        UINT fileCount = DragQueryFileW(hDrop, 0xFFFFFFFF, NULL, 0);
        if (fileCount > 0 && !g_assignment_uploading) {
            wchar_t szFile[MAX_PATH];
            if (DragQueryFileW(hDrop, 0, szFile, MAX_PATH) > 0) {
                std::wstring filePath(szFile);
                std::thread([filePath, hwnd]() {
                    PerformAssignmentUpload(filePath, hwnd);
                }).detach();
            }
        }
        DragFinish(hDrop);
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT rc;
        GetClientRect(hwnd, &rc);
        int w = rc.right - rc.left;
        int h = rc.bottom - rc.top;

        HDC memDC = CreateCompatibleDC(hdc);
        HBITMAP memBitmap = CreateCompatibleBitmap(hdc, w, h);
        HBITMAP oldBitmap = (HBITMAP)SelectObject(memDC, memBitmap);

        // Background: Slate-900 (RGB 15, 23, 42)
        HBRUSH bgBrush = CreateSolidBrush(RGB(15, 23, 42));
        FillRect(memDC, &rc, bgBrush);
        DeleteObject(bgBrush);

        SetBkMode(memDC, TRANSPARENT);

        // Header Background
        RECT headerRc = { 0, 0, w, 52 };
        HBRUSH headerBrush = CreateSolidBrush(RGB(30, 41, 59)); // Slate-800
        FillRect(memDC, &headerRc, headerBrush);
        DeleteObject(headerBrush);

        // Header Border
        HPEN hPen = CreatePen(PS_SOLID, 1, RGB(51, 65, 85));
        HPEN oldPen = (HPEN)SelectObject(memDC, hPen);
        MoveToEx(memDC, 0, 52, NULL);
        LineTo(memDC, w, 52);
        SelectObject(memDC, oldPen);
        DeleteObject(hPen);

        AssignmentConfig cfg;
        {
            std::lock_guard<std::mutex> lock(g_assignment_mutex);
            cfg = g_assignment_config;
        }

        std::wstring wTitle = L"課堂作業收取箱";
        if (!cfg.title.empty()) {
            int len = MultiByteToWideChar(CP_UTF8, 0, cfg.title.c_str(), -1, NULL, 0);
            if (len > 0) {
                wTitle.resize(len - 1);
                MultiByteToWideChar(CP_UTF8, 0, cfg.title.c_str(), -1, &wTitle[0], len);
            }
        }

        SetTextColor(memDC, RGB(241, 245, 249)); // Slate-100
        HFONT hTitleFont = CreateFontW(17, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        HFONT oldF = (HFONT)SelectObject(memDC, hTitleFont);
        RECT titleRc = { 16, 14, w - 16, 40 };
        DrawTextW(memDC, wTitle.c_str(), -1, &titleRc, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

        // Dashed Drop Area Box
        RECT dropRc = { 16, 64, w - 16, h - 48 };
        HPEN dashPen = CreatePen(PS_DASH, 2, RGB(56, 189, 248)); // Sky-400
        HBRUSH dropBrush = CreateSolidBrush(RGB(2, 6, 23)); // Slate-950
        oldPen = (HPEN)SelectObject(memDC, dashPen);
        HBRUSH oldB = (HBRUSH)SelectObject(memDC, dropBrush);
        RoundRect(memDC, dropRc.left, dropRc.top, dropRc.right, dropRc.bottom, 12, 12);
        SelectObject(memDC, oldPen);
        SelectObject(memDC, oldB);
        DeleteObject(dashPen);
        DeleteObject(dropBrush);

        // Center drop icon & instructions
        SetTextColor(memDC, RGB(186, 230, 253)); // Sky-200
        HFONT hDropFont = CreateFontW(15, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                      OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                      DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        SelectObject(memDC, hDropFont);
        RECT dropPromptRc = { dropRc.left, dropRc.top + 20, dropRc.right, dropRc.top + 42 };
        DrawTextW(memDC, L"⬇️ 請將作業檔案拖曳至此處放開", -1, &dropPromptRc, DT_CENTER | DT_SINGLELINE);

        // Allowed formats text
        std::wstring wExt = cfg.allowed_exts.empty() ? L"格式不限" : std::wstring(cfg.allowed_exts.begin(), cfg.allowed_exts.end());
        std::wstring limitText = L"限制格式: " + wExt + L" (上限 " + std::to_wstring(cfg.max_size_mb) + L"MB · 可重複拖曳覆蓋更新)";
        SetTextColor(memDC, RGB(148, 163, 184)); // Slate-400
        HFONT hLimitFont = CreateFontW(12, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                       OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                       DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        SelectObject(memDC, hLimitFont);
        RECT limitRc = { dropRc.left, dropRc.top + 46, dropRc.right, dropRc.top + 66 };
        DrawTextW(memDC, limitText.c_str(), -1, &limitRc, DT_CENTER | DT_SINGLELINE);

        // Bottom status line
        SetTextColor(memDC, g_assignment_status_color);
        HFONT hStatusFont = CreateFontW(13, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                        OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, DEFAULT_QUALITY,
                                        DEFAULT_PITCH | FF_SWISS, L"Microsoft JhengHei");
        SelectObject(memDC, hStatusFont);
        RECT statusRc = { 16, h - 38, w - 16, h - 12 };
        DrawTextW(memDC, g_assignment_status_text.c_str(), -1, &statusRc, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS);

        SelectObject(memDC, oldF);
        DeleteObject(hTitleFont);
        DeleteObject(hDropFont);
        DeleteObject(hLimitFont);
        DeleteObject(hStatusFont);

        BitBlt(hdc, 0, 0, w, h, memDC, 0, 0, SRCCOPY);
        SelectObject(memDC, oldBitmap);
        DeleteObject(memBitmap);
        DeleteDC(memDC);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_CLOSE: {
        ShowWindow(hwnd, SW_HIDE);
        return 0;
    }
    case WM_DESTROY: {
        g_assignment_hwnd = NULL;
        PostQuitMessage(0);
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}
#endif

void Utils::ShowAssignmentDropZone(const std::string& id, const std::string& title, const std::string& allowed_exts, int max_size_mb, const std::string& upload_url, const std::string& token) {
    {
        std::lock_guard<std::mutex> lock(g_assignment_mutex);
        g_assignment_config.id = id;
        g_assignment_config.title = title;
        g_assignment_config.allowed_exts = allowed_exts;
        g_assignment_config.max_size_mb = max_size_mb > 0 ? max_size_mb : 50;
        g_assignment_config.upload_url = upload_url;
        g_assignment_config.token = token;
#ifdef _WIN32
        g_assignment_status_text = L"請將作業檔案拖曳至此處放開即可繳交";
        g_assignment_status_color = RGB(56, 189, 248);
#endif
    }
    g_assignment_active.store(true);

#ifdef _WIN32
    if (g_assignment_hwnd && IsWindow(g_assignment_hwnd)) {
        ShowWindow(g_assignment_hwnd, SW_SHOW);
        SetForegroundWindow(g_assignment_hwnd);
        InvalidateRect(g_assignment_hwnd, NULL, TRUE);
        return;
    }

    if (g_assignment_thread.joinable()) {
        g_assignment_thread.join();
    }

    g_assignment_thread = std::thread([]() {
        HINSTANCE hInstance = GetModuleHandle(NULL);
        WNDCLASSW wc = {0};
        wc.lpfnWndProc = AssignmentDropWndProc;
        wc.hInstance = hInstance;
        wc.lpszClassName = L"GridSightAssignmentDropZone";
        wc.hCursor = LoadCursor(NULL, IDC_ARROW);
        RegisterClassW(&wc);

        int screen_w = GetSystemMetrics(SM_CXSCREEN);
        int screen_h = GetSystemMetrics(SM_CYSCREEN);
        int w = 460;
        int h = 240;
        int x = (screen_w - w) / 2;
        int y = (screen_h - h) / 2;

        HWND hwnd = CreateWindowExW(
            WS_EX_TOPMOST,
            L"GridSightAssignmentDropZone",
            L"GridSight 作業收取箱",
            WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            x, y, w, h,
            NULL, NULL, hInstance, NULL
        );

        if (hwnd) {
            g_assignment_hwnd = hwnd;
            SetForegroundWindow(hwnd);
            UpdateWindow(hwnd);

            MSG msg;
            while (g_assignment_active.load() && GetMessageW(&msg, NULL, 0, 0)) {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if (IsWindow(hwnd)) {
                DestroyWindow(hwnd);
            }
        }
    });
#endif
}

void Utils::HideAssignmentDropZone() {
    g_assignment_active.store(false);
#ifdef _WIN32
    if (g_assignment_hwnd && IsWindow(g_assignment_hwnd)) {
        PostMessageW(g_assignment_hwnd, WM_CLOSE, 0, 0);
    }
#endif
}

bool Utils::IsAssignmentActive() {
    return g_assignment_active.load();
}

} // namespace GridSight

