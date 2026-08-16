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

class Utils {
public:
    static NetworkInfo GetSystemNetworkInfo();
    static uint64_t GetCurrentTimestampMs();
    static void EnableDPIAwareness();
    static void SleepMs(uint32_t ms);
    static std::string GenerateRandomToken(size_t length = 32);
    static void Log(const std::string& level, const std::string& message);
    static void LoadEnv(const std::string& filepath);
    static std::string GetEnv(const std::string& key, const std::string& default_value = "");
    static int GetEnvInt(const std::string& key, int default_value = 0);
};

} // namespace GridSight
