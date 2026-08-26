export interface InstallAgentScriptOptions {
  serverHost: string;
  teacherHost: string;
  teacherPort: number;
  hmacSecret: string;
  version: string;
}

const assertSafeValue = (name: string, value: string, pattern: RegExp): string => {
  if (!pattern.test(value)) {
    throw new Error(`Unsafe ${name} value`);
  }
  return value;
};

/**
 * Build the one-click PowerShell installer from validated server-owned values.
 * Keep the agent configuration filename and keys aligned with beacon/src/main.cpp.
 */
export const buildInstallAgentScript = ({
  serverHost,
  teacherHost,
  teacherPort,
  hmacSecret,
  version,
}: InstallAgentScriptOptions): string => {
  const safeServerHost = assertSafeValue('serverHost', serverHost, /^[A-Za-z0-9._:-]+$/);
  const safeTeacherHost = assertSafeValue('teacherHost', teacherHost, /^[A-Za-z0-9._-]+$/);
  const safeSecret = assertSafeValue('hmacSecret', hmacSecret, /^[a-fA-F0-9]{64}$/);
  const safeVersion = assertSafeValue('version', version, /^\d+\.\d+\.\d+$/);
  if (!Number.isInteger(teacherPort) || teacherPort < 1 || teacherPort > 65535) {
    throw new Error('Invalid teacherPort value');
  }

  return `# ========================================================
# GridSight Agent One-Click Pull & Launch Script (v${safeVersion})
# ========================================================
$ErrorActionPreference = "SilentlyContinue"
$serverHost = "${safeServerHost}"
$exeUrl = "http://$serverHost/download/gs-agent.exe"
$destDir = "$env:TEMP"
$destPath = "$destDir\\gs-agent.exe"
$envPath = "$destDir\\.env"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  GridSight Student Agent v${safeVersion} 部署與啟動程序" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "[GridSight] 正在終止舊版 gs-agent 行程..." -ForegroundColor Yellow

taskkill /F /IM gs-agent.exe /T 2>$null | Out-Null
Start-Sleep -Milliseconds 500

Write-Host "[GridSight] 正在從 $exeUrl 下載最新版 gs-agent.exe..." -ForegroundColor Cyan
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls

try {
    if (Test-Path $destPath) { Remove-Item $destPath -Force }
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "Stop"
    Invoke-WebRequest -Uri $exeUrl -OutFile $destPath -UseBasicParsing
    $ErrorActionPreference = $oldEAP
} catch {
    Write-Host "[GridSight] ❌ 下載學生端程式失敗！請確認與教師端伺服器 (http://$serverHost) 連線正常。" -ForegroundColor Red
    Write-Host "[GridSight] 錯誤詳情: $_" -ForegroundColor Red
    Exit
}

if (!(Test-Path $destPath) -or (Get-Item $destPath).Length -lt 10240) {
    Write-Host "[GridSight] ❌ 下載學生端程式錯誤：下載的檔案無效或大小異常。" -ForegroundColor Red
    if (Test-Path $destPath) {
        $content = Get-Content $destPath -TotalCount 5
        Write-Host "[GridSight] 伺服器回應內容: $content" -ForegroundColor Red
        Remove-Item $destPath -Force
    }
    Exit
}

# Write the exact file and keys consumed by gs-agent from its working directory.
$configLines = @(
    "HMAC_SECRET=${safeSecret}",
    "TEACHER_HOST=${safeTeacherHost}",
    "TEACHER_PORT=${teacherPort}"
)
Set-Content -Path $envPath -Value $configLines -Encoding ASCII
Write-Host "[GridSight] 已寫入 HMAC 與教師端設定至 $envPath" -ForegroundColor DarkGray

try {
    netsh advfirewall firewall delete rule name="GridSight Agent" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="GridSight Agent Out" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="GridSight Agent" dir=in action=allow program="$destPath" enable=yes profile=any protocol=any 2>$null | Out-Null
    netsh advfirewall firewall add rule name="GridSight Agent Out" dir=out action=allow program="$destPath" enable=yes profile=any protocol=any 2>$null | Out-Null
} catch {}

Write-Host "[GridSight] 正在啟動最新版 gs-agent.exe (v${safeVersion})..." -ForegroundColor Green
Start-Process -FilePath $destPath -WorkingDirectory $destDir -WindowStyle Hidden

Start-Sleep -Seconds 1
$proc = Get-Process -Name "gs-agent" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "[GridSight] ✅ 學生端代理程式 (v${safeVersion}) 已成功在背景啟動！ (PID: $($proc[0].Id))" -ForegroundColor Green
} else {
    Write-Host "[GridSight] ⚠️ 警告：無法確認背景行程狀態，請檢查防毒軟體或權限設定。" -ForegroundColor Yellow
}
`;
};
