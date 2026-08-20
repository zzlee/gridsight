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
                uint64_t last_hb = GridSight::Utils::GetLastHeartbeat();
                if ((now - start_time > 60000) && (now - last_hb > 60000)) {
                    GridSight::Utils::Log("ERROR", "Watchdog: Worker process deadlocked (no heartbeat for 60s). Terminating...");
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
                    uint64_t last_hb = GridSight::Utils::GetLastHeartbeat();
                    if ((now - start_time > 60000) && (now - last_hb > 60000)) {
                        GridSight::Utils::Log("ERROR", "Watchdog: Worker process deadlocked (no heartbeat for 60s). Terminating...");
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
    GridSight::Utils::Log("INFO", " GridSight Beacon Agent v5.3.3 (Outbound Relay + Win32)");
    GridSight::Utils::Log("INFO", "=======================================================");

    // Load .env configuration
    GridSight::Utils::LoadEnv(".env");

    std::string multicast_ip = GridSight::Utils::GetEnv("MULTICAST_IP", "239.255.42.99");
    int multicast_port = GridSight::Utils::GetEnvInt("MULTICAST_PORT", 8888);
    int http_port = GridSight::Utils::GetEnvInt("HTTP_PORT", 8080);
    int ws_port = GridSight::Utils::GetEnvInt("WS_PORT", 8081);
    std::string rtp_ip = GridSight::Utils::GetEnv("RTP_IP", "239.255.42.100");
    int rtp_port = GridSight::Utils::GetEnvInt("RTP_PORT", 9000);

    auto capturer = std::make_shared<GridSight::ScreenCapturer>();
    if (!capturer->Initialize()) {
        GridSight::Utils::Log("ERROR", "Failed to initialize ScreenCapturer");
    }

    // 1. Start HTTP Server with Outbound Snapshot Push to Teacher
    auto http_server = std::make_shared<GridSight::HttpServer>(http_port, capturer);
    std::string default_teacher = GridSight::Utils::GetEnv("TEACHER_IP", "192.168.190.201");
    http_server->SetTeacherHost(default_teacher, 3000);
    http_server->Start();

    // 2. Start Beacon Discovery (notifies http_server of discovered teacher IP)
    GridSight::BeaconClient beacon_client(multicast_ip, multicast_port, http_server);
    beacon_client.Start();

    // 3. Start WebSocket Server for On-demand 30 FPS Stream (with Outbound Reverse Streaming)
    auto ws_streamer = std::make_shared<GridSight::WebSocketStreamer>(ws_port, capturer);
    ws_streamer->SetTeacherHost(default_teacher, 3000);
    ws_streamer->Start();

    // 4. Start RTP Receiver for Teacher Multicast Broadcast
    GridSight::RTPReceiver rtp_receiver(rtp_ip, rtp_port);
    rtp_receiver.Start();

    GridSight::Utils::Log("INFO", "GridSight Beacon running.");

    while (g_keep_running) {
        GridSight::Utils::SleepMs(1000);
    }

    GridSight::Utils::Log("INFO", "GridSight Beacon shutting down...");
    rtp_receiver.Stop();
    ws_streamer->Stop();
    http_server->Stop();
    beacon_client.Stop();
    capturer->Release();

    return 0;
}
