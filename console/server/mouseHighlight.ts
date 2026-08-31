import { spawn, spawnSync, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

/*
 * Pointer Encoder:
 * C# application using Low-Level Mouse Hook (WH_MOUSE_LL) to capture mouse coordinates,
 * cursor shapes, click events, and scroll wheel actions. It normalizes coordinates to 0-65535,
 * includes UTC timestamps in milliseconds, formats metadata as JSON, and broadcasts via UDP Multicast.
 */
const CSHARP_EFFECT_SOURCE = `
using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace GridSightPointerEncoder
{
    static class Program
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern bool GetCursorInfo(out CURSORINFO pci);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct CURSORINFO {
            public Int32 cbSize;
            public Int32 flags;
            public IntPtr hCursor;
            public POINT ptScreenPos;
        }

        private const int WH_MOUSE_LL = 14;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_MOUSEWHEEL = 0x020A;

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

        private static LowLevelMouseProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static UdpClient _udpClient;
        private static IPEndPoint _endPoint;
        private static Timer _timer;
        private static string _lastClick = "none";
        private static string _lastScroll = "none";

        [STAThread]
        static void Main(string[] args)
        {
            string mcastIp = args.Length > 0 ? args[0] : "239.255.42.100";
            int port = args.Length > 1 ? int.Parse(args[1]) : 9001;

            _udpClient = new UdpClient();
            _endPoint = new IPEndPoint(IPAddress.Parse(mcastIp), port);

            _hookID = SetHook(_proc);

            _timer = new Timer();
            _timer.Interval = 16; // ~60 FPS update rate
            _timer.Tick += (s, e) => SendPointerState();
            _timer.Start();

            Application.Run();

            _timer.Stop();
            UnhookWindowsHookEx(_hookID);
            _udpClient.Close();
        }

        private static IntPtr SetHook(LowLevelMouseProc proc)
        {
            using (var curProcess = System.Diagnostics.Process.GetCurrentProcess())
            using (var curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                int msg = wParam.ToInt32();

                if (msg == WM_LBUTTONDOWN)
                {
                    _lastClick = "left";
                }
                else if (msg == WM_RBUTTONDOWN)
                {
                    _lastClick = "right";
                }
                else if (msg == WM_MOUSEWHEEL)
                {
                    int delta = (short)((hookStruct.mouseData >> 16) & 0xffff);
                    _lastScroll = delta > 0 ? "up" : "down";
                }
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        private static void SendPointerState()
        {
            try
            {
                int left = SystemInformation.VirtualScreen.Left;
                int top = SystemInformation.VirtualScreen.Top;
                int width = SystemInformation.VirtualScreen.Width;
                int height = SystemInformation.VirtualScreen.Height;

                System.Drawing.Point pt = Cursor.Position;
                int normX = (int)Math.Max(0, Math.Min(65535, ((double)(pt.X - left) / Math.Max(1, width)) * 65535.0));
                int normY = (int)Math.Max(0, Math.Min(65535, ((double)(pt.Y - top) / Math.Max(1, height)) * 65535.0));

                long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                string cursorType = "IDC_ARROW";
                CURSORINFO ci = new CURSORINFO();
                ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO));
                if (GetCursorInfo(out ci) && ci.flags == 1)
                {
                    cursorType = ci.hCursor.ToString();
                }

                string json = string.Format(
                    "{{\\"x\\":{0},\\"y\\":{1},\\"timestamp\\":{2},\\"cursor\\":\\"{3}\\",\\"click\\":\\"{4}\\",\\"scroll\\":\\"{5}\\"}}",
                    normX, normY, timestamp, cursorType, _lastClick, _lastScroll
                );

                byte[] data = Encoding.UTF8.GetBytes(json);
                _udpClient.Send(data, data.Length, _endPoint);

                _lastClick = "none";
                _lastScroll = "none";
            }
            catch {}
        }
    }
}
`;

export class MouseHighlightOverlay {
  private process: ChildProcess | null = null;

  start(multicastIp: string = '239.255.42.100', port: number = 9001): boolean {
    if (os.platform() !== 'win32') {
      logger.info('[MouseHighlight] Non-Windows platform; skipping mouse effect overlay.');
      return false;
    }

    if (this.process && this.process.exitCode === null) {
      return true;
    }

    try {
      const tempDir = os.tmpdir();
      const csPath = path.join(tempDir, 'GridSightMouseOverlay.cs');
      const exePath = path.join(tempDir, 'GridSightMouseOverlay.exe');

      fs.writeFileSync(csPath, CSHARP_EFFECT_SOURCE, 'utf-8');

      // Synchronously compile C# overlay on-the-fly if needed using csc.exe
      const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
      if (fs.existsSync(cscPath) && !fs.existsSync(exePath)) {
        logger.info('[MouseHighlight] Compiling C# mouse overlay executable...');
        const res = spawnSync(cscPath, ['/target:winexe', `/out:${exePath}`, csPath], { windowsHide: true });
        if (res.status === 0 && fs.existsSync(exePath)) {
          logger.info('[MouseHighlight] Mouse effect overlay compiled successfully.');
        } else {
          logger.warn(`[MouseHighlight] csc compilation failed with code ${res.status}`);
        }
      }

      if (fs.existsSync(exePath)) {
        logger.info('[MouseHighlight] Launching precompiled mouse pointer encoder.');
        this.process = spawn(exePath, [multicastIp, String(port)], { detached: true, stdio: 'ignore' });
        return true;
      }

      // PowerShell fallback compile & run script
      logger.info('[MouseHighlight] Launching mouse pointer encoder via PowerShell fallback.');
      const psScript = `
$code = @"
${CSHARP_EFFECT_SOURCE}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies "System.Windows.Forms","System.Drawing","System.Core"
[GridSightPointerEncoder.Program]::Main(@('${multicastIp}', '${port}'))
`;
      const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
      this.process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
        detached: true,
        stdio: 'ignore',
      });
      return true;
    } catch (err) {
      logger.warn(`[MouseHighlight] Failed to launch mouse effect overlay: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  stop() {
    if (this.process) {
      try {
        if (os.platform() === 'win32' && this.process.pid) {
          spawn('taskkill', ['/F', '/PID', String(this.process.pid), '/T'], { windowsHide: true });
          spawn('taskkill', ['/F', '/IM', 'GridSightMouseOverlay.exe', '/T'], { windowsHide: true });
        }
        this.process.kill('SIGTERM');
      } catch {}
      this.process = null;
      logger.info('[MouseHighlight] Mouse effect overlay terminated.');
    }
  }
}
