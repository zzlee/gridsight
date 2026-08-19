#include "../beacon/include/utils.h"
#include <iostream>
#include <chrono>
#include <vector>
#include <thread>
#include <set>
#include <mutex>
#include <random>
#include <cassert>

using namespace GridSight;

std::string LegacyGenerateRandomToken(size_t length) {
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

int main() {
    std::cout << "=========================================\n";
    std::cout << " GridSight Random Token Generator Benchmark\n";
    std::cout << "=========================================\n\n";

    const int iterations = 100000;

    // 1. Single-threaded Benchmark: Baseline vs Optimized
    std::cout << "Running single-threaded performance benchmark (" << iterations << " iterations)...\n";

    // Warmup
    LegacyGenerateRandomToken(32);
    Utils::GenerateRandomToken(32);

    auto start_baseline = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        volatile auto s = LegacyGenerateRandomToken(32);
    }
    auto end_baseline = std::chrono::high_resolution_clock::now();

    auto start_optimized = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < iterations; ++i) {
        volatile auto s = Utils::GenerateRandomToken(32);
    }
    auto end_optimized = std::chrono::high_resolution_clock::now();

    double ms_baseline = std::chrono::duration<double, std::milli>(end_baseline - start_baseline).count();
    double ms_optimized = std::chrono::duration<double, std::milli>(end_optimized - start_optimized).count();

    std::cout << "Baseline (Legacy) : " << ms_baseline << " ms (" << (ms_baseline / iterations * 1000.0) << " us/call)\n";
    std::cout << "Optimized (New)   : " << ms_optimized << " ms (" << (ms_optimized / iterations * 1000.0) << " us/call)\n";
    std::cout << "Speedup           : " << (ms_baseline / ms_optimized) << "x\n\n";

    // 2. Output Verification
    std::cout << "Verifying token contract and length...\n";
    std::string t16 = Utils::GenerateRandomToken(16);
    std::string t32 = Utils::GenerateRandomToken(32);
    std::string t64 = Utils::GenerateRandomToken(64);
    assert(t16.length() == 16);
    assert(t32.length() == 32);
    assert(t64.length() == 64);
    std::cout << "Sample Token (32-char): " << t32 << "\n";
    std::cout << "Length check: PASSED\n\n";

    // 3. Multi-threaded Correctness & Collision Test
    std::cout << "Running multi-threaded concurrency and collision test...\n";
    const int num_threads = 8;
    const int tokens_per_thread = 10000;
    std::vector<std::thread> threads;
    std::mutex set_mutex;
    std::set<std::string> all_tokens;

    for (int t = 0; t < num_threads; ++t) {
        threads.emplace_back([&]() {
            std::vector<std::string> local_tokens;
            local_tokens.reserve(tokens_per_thread);
            for (int i = 0; i < tokens_per_thread; ++i) {
                local_tokens.push_back(Utils::GenerateRandomToken(32));
            }
            std::lock_guard<std::mutex> lock(set_mutex);
            for (const auto& token : local_tokens) {
                all_tokens.insert(token);
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    int total_expected = num_threads * tokens_per_thread;
    std::cout << "Generated " << total_expected << " tokens across " << num_threads << " threads.\n";
    std::cout << "Unique tokens: " << all_tokens.size() << "\n";
    assert(all_tokens.size() == static_cast<size_t>(total_expected));
    std::cout << "Multi-threaded concurrency check: PASSED\n\n";

    std::cout << "All benchmark and verification tests PASSED successfully!\n";
    return 0;
}
