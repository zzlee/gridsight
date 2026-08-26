#pragma once
#include <string>
#include <vector>
#include <cstdint>

namespace GridSight {

struct NetworkInfo {
    std::string ip;
    std::string mac;
    std::string hostname;
    std::string username;
};

struct SystemHardwareInfo {
    std::string hostname;
    std::string os_name;
    std::string cpu_model;
    int cpu_cores = 0;
    double cpu_usage_percent = 0.0;
    uint64_t ram_total_mb = 0;
    uint64_t ram_avail_mb = 0;
    double ram_usage_percent = 0.0;
    std::string disk_drive = "C:";
    uint64_t disk_total_gb = 0;
    uint64_t disk_free_gb = 0;
    double disk_usage_percent = 0.0;
    uint64_t uptime_seconds = 0;
};

class Utils {
public:
    static NetworkInfo GetSystemNetworkInfo();
    static SystemHardwareInfo GetSystemHardwareInfo();
    static uint64_t GetCurrentTimestampMs();
    static void EnableDPIAwareness();
    static void SleepMs(uint32_t ms);
    static std::string GenerateRandomToken(size_t length = 32);
    static void Log(const std::string& level, const std::string& message);
    static void LoadEnv(const std::string& filepath);
    static std::string GetEnv(const std::string& key, const std::string& default_value = "");
    static int GetEnvInt(const std::string& key, int default_value = 0);

    static std::string GetActiveWindowTitle();
    static std::string Base64Encode(const uint8_t* data, size_t len);
    static std::string ComputeWebSocketAcceptKey(const std::string& client_key);
    static void UpdateHeartbeat(const std::string& component = "worker");
    static uint64_t GetLastHeartbeat(const std::string& component = "worker");

    static std::string JsonEscape(const std::string& input);
    static std::string ExtractJsonField(const std::string& json, const std::string& field_name);
    static void OpenUrl(const std::string& url);
    static bool DownloadAndOpenFile(const std::string& url, const std::string& filename);

    static std::string HMACSHA256Hex(const std::string& key, const std::string& data);
    static bool VerifyHMACSHA256(const std::string& key, const std::string& data, const std::string& expected_hex);
};

} // namespace GridSight
