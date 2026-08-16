#include "../include/token_manager.h"

namespace GridSight {

TokenManager& TokenManager::Instance() {
    static TokenManager instance;
    return instance;
}

void TokenManager::SetSessionToken(const std::string& token) {
    std::lock_guard<std::mutex> lock(mutex_);
    session_token_ = token;
}

std::string TokenManager::GetSessionToken() {
    std::lock_guard<std::mutex> lock(mutex_);
    return session_token_;
}

bool TokenManager::ValidateToken(const std::string& candidate) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (session_token_.empty()) return false;
    return session_token_ == candidate;
}

bool TokenManager::HasValidToken() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return !session_token_.empty();
}

void TokenManager::ClearToken() {
    std::lock_guard<std::mutex> lock(mutex_);
    session_token_.clear();
}

} // namespace GridSight
