#!/usr/bin/env powershell
# ==============================================================================
# GridSight - Windows Real-Machine Diagnostic Collector
# Collects agent logs, firewall rules, multicast memberships, routing,
# process state and WER events into a single zip for offline analysis.
# Run on a STUDENT machine (or teacher machine) with admin rights.
# Usage: powershell -ExecutionPolicy Bypass -File collect-windows-diagnostics.ps1
# ==============================================================================
$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $env:TEMP "gridsight-diag_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Write-Host "[GridSight Diag] Output: $outDir"

function Save-Step($name, $scriptblock) {
    Write-Host "  [..] $name"
    try {
        & $scriptblock > (Join-Path $outDir "$name.txt") 2>&1
    } catch {
        "STEP FAILED: $_" | Out-File (Join-Path $outDir "$name.txt")
    }
}

# 1. Locate gs-agent processes and their CWD (log files live there)
Save-Step "01-processes" {
    Get-Process gs-agent -ErrorAction SilentlyContinue |
        Format-Table Id, Path, StartTime -AutoSize
}

# 2. Agent logs (search common locations: TEMP, System32, exe dir)
Save-Step "02-agent-log-tail" {
    $candidates = @(
        (Join-Path $env:TEMP "gs-agent.log"),
        (Join-Path $env:SystemRoot "System32\gs-agent.log")
    )
    foreach ($p in (Get-Process gs-agent -ErrorAction SilentlyContinue)) {
        if ($p.Path) { $candidates += (Join-Path (Split-Path $p.Path) "gs-agent.log") }
    }
    foreach ($log in ($candidates | Select-Object -Unique | Where-Object { Test-Path $_ })) {
        "`n===== $log ====="
        Get-Content $log -Tail 200
        $rot = "$log.1"
        if (Test-Path $rot) { "`n----- rotated: $rot -----"; Get-Content $rot -Tail 100 }
    }
}

# 3. Component heartbeat files used by the watchdog and health diagnostics
Save-Step "03-component-heartbeats" {
    Get-ChildItem $env:TEMP -Filter "gs-heartbeat*.txt" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $value = Get-Content $_.FullName -ErrorAction SilentlyContinue
            [PSCustomObject]@{ Component = $_.BaseName; TimestampMs = $value; LastWriteTime = $_.LastWriteTime }
        } | Format-Table -AutoSize
}

# 4. Firewall rules related to GridSight / node / ffmpeg
Save-Step "04-firewall" {
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match "GridSight|node|ffmpeg" } |
        Format-Table DisplayName, Enabled, Direction, Action, Profile -AutoSize
}

# 4. Multicast group memberships (discovery 239.255.42.99, broadcast 239.255.42.100)
Save-Step "05-multicast-joins" {
    netsh int ipv4 show joins
}

# 5. Routing table + adapters (virtual NIC ordering issues)
Save-Step "06-network" {
    route print
    ""
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Format-Table IPAddress, InterfaceAlias, PrefixOrigin -AutoSize
}

# 6. Connectivity probes toward teacher console (port 3000)
Save-Step "07-connectivity" {
    "Ping sweep of default gateway and common teacher reachability:"
    Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -WarningAction SilentlyContinue |
        Format-List ComputerName, RemotePort, TcpTestSucceeded
}

# 7. WER crash events for gs-agent.exe
Save-Step "08-wer-events" {
    Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "Windows Error Reporting" } `
        -MaxEvents 50 -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match "gs-agent" } |
        Format-List TimeCreated, Message
}

# 8. Crash dumps present?
Save-Step "09-crash-dumps" {
    if (Test-Path "C:\GridSightDumps") { Get-ChildItem "C:\GridSightDumps" | Format-Table Name, Length, LastWriteTime -AutoSize }
    else { "No C:\GridSightDumps directory (WER LocalDumps not configured?)" }
}

# 9. Session info (DXGI capture requires physical Session 1 logon)
Save-Step "10-sessions" {
    query session 2>&1
    ""
    whoami /groups | Select-String "Session|Logon"
}

# 10. ffmpeg presence (teacher machines)
Save-Step "11-ffmpeg" {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { ffmpeg -version | Select-Object -First 2 }
    else { "ffmpeg NOT FOUND in PATH (broadcast will fail on this machine)" }
}

# Package
$zip = Join-Path $env:TEMP "gridsight-diag_$stamp.zip"
Compress-Archive -Path "$outDir\*" -DestinationPath $zip -Force
Write-Host "`n[GridSight Diag] Done. Please share: $zip"
Write-Host "[GridSight Diag] Raw folder kept at: $outDir"
