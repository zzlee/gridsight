#include "../include/capture.h"
#include "../include/beacon_client.h"
#include "../include/http_server.h"
#include "../include/ws_server.h"
#include "../include/rtp_receiver.h"
#include "../include/token_manager.h"
#include "../include/utils.h"
#include <iostream>
#include <memory>
#include <csignal>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#else
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <string.h>
#endif

std::atomic<bool> g_keep_running{true};

#ifdef _WIN32
HANDLE g_child_process = NULL;

class WinsockRuntime {
public:
    bool Initialize() {
        WSADATA data;
        int result = WSAStartup(MAKEWORD(2, 2), &data);
        if (result != 0) {
            GridSight::Utils::Log("ERROR", "Winsock initialization failed with error " + std::to_string(result));
            return false;
        }
        initialized_ = true;
        GridSight::Utils::Log("INFO", "Winsock 2.2 initialized for worker networking");
        return true;
    }

    ~WinsockRuntime() {
        if (initialized_) WSACleanup();
    }

private:
    bool initialized_ = false;
};
#else
pid_t g_child_pid = -1;
#endif

void SignalHandler(int signum) {
    g_keep_running = false;
#ifdef _WIN32
    if (g_child_process) {
        TerminateProcess(g_child_process, 0);
    }
#else
    if (g_child_pid > 0) {
        kill(g_child_pid, SIGTERM);
    }
#endif
}

void RunWatchdog(const char* exe_path) {
    GridSight::Utils::Log("INFO", "GridSight Watchdog started. Monitoring worker process...");

    while (g_keep_running) {
#ifdef _WIN32
        STARTUPINFOA si;
        PROCESS_INFORMATION pi;
        ZeroMemory(&si, sizeof(si));
        si.cb = sizeof(si);
        ZeroMemory(&pi, sizeof(pi));

        std::string cmd = "\"" + std::string(exe_path) + "\" --worker";

        // Create the child process
        if (!CreateProcessA(NULL, const_cast<LPSTR>(cmd.c_str()), NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
            GridSight::Utils::Log("ERROR", "Watchdog failed to create worker process. Retrying in 5s...");
            GridSight::Utils::SleepMs(5000);
            continue;
        }

        g_child_process = pi.hProcess;
        GridSight::Utils::Log("INFO", "Watchdog spawned worker process (PID: " + std::to_string(pi.dwProcessId) + ")");

        // Wait until child process exits or timeout
        uint64_t start_time = GridSight::Utils::GetCurrentTimestampMs();
        DWORD exit_code = 0;
        bool crashed = false;

        while (g_keep_running) {
            DWORD wait_res = WaitForSingleObject(pi.hProcess, 5000);
            if (wait_res == WAIT_OBJECT_0) {
                // Process exited
                break;
            } else if (wait_res == WAIT_TIMEOUT) {
                // Check heartbeat
                uint64_t now = GridSight::Utils::GetCurrentTimestampMs();
                uint64_t last_worker_hb = GridSight::Utils::GetLastHeartbeat();
                uint64_t last_capture_worker_hb = GridSight::Utils::GetLastHeartbeat("capture-worker");
                if ((now - start_time > 60000) &&
                    ((now - last_worker_hb > 60000) || (now - last_capture_worker_hb > 60000))) {
                    GridSight::Utils::Log("ERROR", "Watchdog: Worker or capture pipeline stalled for 60s. Terminating...");
                    TerminateProcess(pi.hProcess, 1);
                    crashed = true;
                    break;
                }
            }
        }

        GetExitCodeProcess(pi.hProcess, &exit_code);

        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        g_child_process = NULL;

        if (!g_keep_running) break;

        GridSight::Utils::Log("WARNING", "Worker process exited with code " + std::to_string(exit_code) + (crashed ? " (Killed)" : "") + ". Restarting...");
        GridSight::Utils::SleepMs(1000); // Backoff before restart
#else
        pid_t pid = fork();
        if (pid < 0) {
            GridSight::Utils::Log("ERROR", "Watchdog failed to fork. Retrying in 5s...");
            GridSight::Utils::SleepMs(5000);
            continue;
        }

        if (pid == 0) {
            // Child process
            execlp(exe_path, exe_path, "--worker", NULL);
            // If execlp fails
            GridSight::Utils::Log("ERROR", "Watchdog failed to exec worker process.");
            exit(1);
        } else {
            // Parent process
            g_child_pid = pid;
            GridSight::Utils::Log("INFO", "Watchdog spawned worker process (PID: " + std::to_string(pid) + ")");

            int status;
            uint64_t start_time = GridSight::Utils::GetCurrentTimestampMs();
            bool crashed = false;

            while (g_keep_running) {
                pid_t wpid = waitpid(pid, &status, WNOHANG);
                if (wpid == pid) {
                    break; // Exited
                } else if (wpid == 0) {
                    // Still running, check heartbeat
                    uint64_t now = GridSight::Utils::GetCurrentTimestampMs();
                    uint64_t last_worker_hb = GridSight::Utils::GetLastHeartbeat();
                    uint64_t last_capture_worker_hb = GridSight::Utils::GetLastHeartbeat("capture-worker");
                    if ((now - start_time > 60000) &&
                        ((now - last_worker_hb > 60000) || (now - last_capture_worker_hb > 60000))) {
                        GridSight::Utils::Log("ERROR", "Watchdog: Worker or capture pipeline stalled for 60s. Terminating...");
                        kill(pid, SIGKILL);
                        crashed = true;
                        waitpid(pid, &status, 0); // Cleanup
                        break;
                    }
                    GridSight::Utils::SleepMs(5000);
                }
            }

            g_child_pid = -1;

            if (!g_keep_running) break;

            if (crashed) {
                GridSight::Utils::Log("WARNING", "Worker process killed due to heartbeat timeout. Restarting...");
            } else if (WIFEXITED(status)) {
                GridSight::Utils::Log("WARNING", "Worker process exited with code " + std::to_string(WEXITSTATUS(status)) + ". Restarting...");
            } else if (WIFSIGNALED(status)) {
                GridSight::Utils::Log("WARNING", "Worker process killed by signal " + std::to_string(WTERMSIG(status)) + ". Restarting...");
            }
            GridSight::Utils::SleepMs(1000); // Backoff before restart
        }
#endif
    }

    GridSight::Utils::Log("INFO", "GridSight Watchdog shutting down...");
}

#ifdef _WIN32
int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    bool is_worker = (strstr(lpCmdLine, "--worker") != NULL);
    char exe_path[MAX_PATH];
    GetModuleFileNameA(NULL, exe_path, MAX_PATH);
#else
int main(int argc, char* argv[]) {
    bool is_worker = false;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--worker") == 0) {
            is_worker = true;
            break;
        }
    }
    const char* exe_path = argv[0];
#endif
    signal(SIGINT, SignalHandler);
    signal(SIGTERM, SignalHandler);

    if (!is_worker) {
        RunWatchdog(exe_path);
        return 0;
    }

    GridSight::Utils::Log("INFO", "=======================================================");
    GridSight::Utils::Log("INFO", " GridSight Beacon Agent v5.6.0 (Outbound Relay + Win32)");
    GridSight::Utils::Log("INFO", "=======================================================");

#ifdef _WIN32
    // Winsock must be initialized before any HTTP, WebSocket, beacon, or RTP
    // thread can call socket(). The watchdog process intentionally skips it.
    WinsockRuntime winsock;
    if (!winsock.Initialize()) {
        GridSight::Utils::Log("ERROR", "Worker startup aborted because networking is unavailable");
        return 2;
    }
#endif

    // Load .env configuration
    GridSight::Utils::LoadEnv(".env");

    std::string multicast_ip = GridSight::Utils::GetEnv("MULTICAST_IP", "239.255.42.99");
    int multicast_port = GridSight::Utils::GetEnvInt("MULTICAST_PORT", 8888);
    int http_port = GridSight::Utils::GetEnvInt("HTTP_PORT", 8080);
    int ws_port = GridSight::Utils::GetEnvInt("WS_PORT", 8081);
    std::string rtp_ip = GridSight::Utils::GetEnv("RTP_IP", "239.255.42.100");
    int rtp_port = GridSight::Utils::GetEnvInt("RTP_PORT", 9000);
    std::string hmac_secret = GridSight::Utils::GetEnv("HMAC_SECRET", "");
    std::string teacher_host = GridSight::Utils::GetEnv(
        "TEACHER_HOST",
        GridSight::Utils::GetEnv("TEACHER_IP", "192.168.190.201"));
    int teacher_port = GridSight::Utils::GetEnvInt("TEACHER_PORT", 3000);

    // Backward compatibility for legacy TEACHER_IP=host:port files. New
    // installers always write TEACHER_HOST and TEACHER_PORT separately.
    const size_t legacy_colon = teacher_host.rfind(':');
    if (legacy_colon != std::string::npos && teacher_host.find(':') == legacy_colon) {
        try {
            const int parsed_port = std::stoi(teacher_host.substr(legacy_colon + 1));
            if (parsed_port > 0 && parsed_port <= 65535) {
                teacher_port = parsed_port;
                teacher_host = teacher_host.substr(0, legacy_colon);
            }
        } catch (...) {
            GridSight::Utils::Log("WARN", "Invalid legacy TEACHER_IP endpoint; waiting for multicast discovery");
        }
    }

    auto capturer = std::make_shared<GridSight::ScreenCapturer>();
    if (!capturer->Initialize()) {
        GridSight::Utils::Log("WARN", "Initial ScreenCapturer setup failed; capture requests will retry initialization");
    }

    // 1. Start snapshot and focus-stream services with the configured
    // bootstrap endpoint. A verified TOKEN_GRANT updates both destinations.
    auto http_server = std::make_shared<GridSight::HttpServer>(http_port, capturer);
    auto ws_streamer = std::make_shared<GridSight::WebSocketStreamer>(ws_port, capturer);
    http_server->SetTeacherHost(teacher_host, teacher_port);
    ws_streamer->SetTeacherHost(teacher_host, teacher_port);
    if (!http_server->Start()) {
        GridSight::Utils::Log("WARN", "HttpServer inbound listener is unavailable; outbound snapshot worker may still be active");
    }
    if (!ws_streamer->Start()) {
        GridSight::Utils::Log("WARN", "WebSocket inbound fallback is unavailable; reverse outbound focus streaming may still be active");
    }

    // 2. Start discovery only after both consumers exist, so every verified
    // teacher endpoint update is applied atomically to snapshot and WS paths.
    GridSight::BeaconClient beacon_client(
        multicast_ip, multicast_port, http_server, ws_streamer, hmac_secret);
    beacon_client.Start();

    // 3. Start RTP Receiver for Teacher Multicast Broadcast
    GridSight::RTPReceiver rtp_receiver(rtp_ip, rtp_port);
    if (!rtp_receiver.Start()) {
        GridSight::Utils::Log("ERROR", "RTPReceiver failed to start; teacher broadcast reception is unavailable");
    }

    GridSight::Utils::Log("INFO", "GridSight Beacon worker startup sequence completed.");

    while (g_keep_running) {
        GridSight::Utils::SleepMs(1000);
    }

    GridSight::Utils::Log("INFO", "GridSight Beacon shutting down...");
    // Stop discovery first so it cannot publish a new endpoint while the
    // destination consumers are draining.
    beacon_client.Stop();
    rtp_receiver.Stop();
    ws_streamer->Stop();
    http_server->Stop();
    capturer->Release();

    return 0;
}
