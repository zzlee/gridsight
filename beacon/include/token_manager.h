#pragma once
#include <string>
#include <mutex>

namespace GridSight {

class TokenManager {
public:
    static TokenManager& Instance();

    void SetSessionToken(const std::string& token);
    std::string GetSessionToken();
    bool ValidateToken(const std::string& candidate);
    bool HasValidToken() const;
    void ClearToken();

private:
    TokenManager() = default;
    ~TokenManager() = default;
    TokenManager(const TokenManager&) = delete;
    TokenManager& operator=(const TokenManager&) = delete;

    mutable std::mutex mutex_;
    std::string session_token_;
};

} // namespace GridSight
