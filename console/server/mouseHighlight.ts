import { spawn, spawnSync, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

/*
 * C# source for the transparent WinForms overlay process with Low-Level Mouse Hook (WH_MOUSE_LL).
 * Renders Option A effects:
 * - Yellow halo around cursor
 * - Cyan ripple on Left click
 * - Amber double-ripple on Right click
 * - Up/Down scroll indicator bubbles near cursor
 * Window flags: WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_NOACTIVATE
 * Click-through enabled (does not block user inputs).
 */
const CSHARP_EFFECT_SOURCE = `
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace GridSightOverlay
{
    static class Program
    {
        [DllImport("user32.dll", SetLastError = true)]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_LAYERED = 0x00080000;
        private const int WS_EX_TOPMOST = 0x00000008;
        private const int WS_EX_NOACTIVATE = 0x08000000;
        private const uint LWA_COLORKEY = 0x00000001;

        private const int WH_MOUSE_LL = 14;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_MOUSEWHEEL = 0x020A;

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

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

        private static LowLevelMouseProc _proc = HookCallback;
        private static IntPtr _hookID = IntPtr.Zero;
        private static OverlayForm _form;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            _hookID = SetHook(_proc);
            _form = new OverlayForm();
            Application.Run(_form);
            UnhookWindowsHookEx(_hookID);
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
            if (nCode >= 0 && _form != null && !_form.IsDisposed)
            {
                MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                int msg = wParam.ToInt32();

                if (msg == WM_LBUTTONDOWN)
                {
                    _form.AddClickEffect(hookStruct.pt.x, hookStruct.pt.y, true);
                }
                else if (msg == WM_RBUTTONDOWN)
                {
                    _form.AddClickEffect(hookStruct.pt.x, hookStruct.pt.y, false);
                }
                else if (msg == WM_MOUSEWHEEL)
                {
                    int delta = (short)((hookStruct.mouseData >> 16) & 0xffff);
                    _form.AddScrollEffect(hookStruct.pt.x, hookStruct.pt.y, delta > 0);
                }
            }
            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }
    }

    public class OverlayForm : Form
    {
        private class ClickEffect
        {
            public int X;
            public int Y;
            public bool IsLeft;
            public float Radius;
            public float MaxRadius;
            public float Alpha;
        }

        private class ScrollEffect
        {
            public int X;
            public int Y;
            public bool IsUp;
            public float Alpha;
            public float OffsetY;
        }

        private readonly List<ClickEffect> _clickEffects = new List<ClickEffect>();
        private readonly List<ScrollEffect> _scrollEffects = new List<ScrollEffect>();
        private readonly Timer _timer;

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")]
        static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll")]
        static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

        public OverlayForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.ShowInTaskbar = false;
            this.TopMost = true;

            int left = SystemInformation.VirtualScreen.Left;
            int top = SystemInformation.VirtualScreen.Top;
            int width = SystemInformation.VirtualScreen.Width;
            int height = SystemInformation.VirtualScreen.Height;

            this.Bounds = new Rectangle(left, top, width, height);
            this.BackColor = Color.Magenta;
            this.TransparencyKey = Color.Magenta;
            this.DoubleBuffered = true;

            _timer = new Timer();
            _timer.Interval = 16; // ~60 FPS
            _timer.Tick += (s, e) => UpdateEffects();
            _timer.Start();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int initialStyle = GetWindowLong(this.Handle, -20);
            SetWindowLong(this.Handle, -20, initialStyle | 0x00080000 | 0x00000020 | 0x00000008 | 0x08000000);
            SetLayeredWindowAttributes(this.Handle, (uint)ColorToRGB(Color.Magenta), 0, 1);
        }

        private int ColorToRGB(Color c)
        {
            return c.R | (c.G << 8) | (c.B << 16);
        }

        public void AddClickEffect(int x, int y, bool isLeft)
        {
            lock (_clickEffects)
            {
                _clickEffects.Add(new ClickEffect {
                    X = x,
                    Y = y,
                    IsLeft = isLeft,
                    Radius = 10,
                    MaxRadius = isLeft ? 45 : 55,
                    Alpha = 255
                });
            }
        }

        public void AddScrollEffect(int x, int y, bool isUp)
        {
            lock (_scrollEffects)
            {
                _scrollEffects.Add(new ScrollEffect {
                    X = x,
                    Y = y,
                    IsUp = isUp,
                    Alpha = 255,
                    OffsetY = 0
                });
            }
        }

        private void UpdateEffects()
        {
            bool needRedraw = false;
            lock (_clickEffects)
            {
                for (int i = _clickEffects.Count - 1; i >= 0; i--)
                {
                    var eff = _clickEffects[i];
                    eff.Radius += 2.5f;
                    eff.Alpha -= 12f;
                    if (eff.Alpha <= 0 || eff.Radius >= eff.MaxRadius)
                    {
                        _clickEffects.RemoveAt(i);
                    }
                    needRedraw = true;
                }
            }

            lock (_scrollEffects)
            {
                for (int i = _scrollEffects.Count - 1; i >= 0; i--)
                {
                    var eff = _scrollEffects[i];
                    eff.OffsetY += eff.IsUp ? -1.5f : 1.5f;
                    eff.Alpha -= 10f;
                    if (eff.Alpha <= 0)
                    {
                        _scrollEffects.RemoveAt(i);
                    }
                    needRedraw = true;
                }
            }

            // Always redraw to move yellow halo with mouse cursor
            this.Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            Point cursorPt = Cursor.Position;
            int cx = cursorPt.X - this.Left;
            int cy = cursorPt.Y - this.Top;

            // Option A: Yellow semi-transparent halo around mouse cursor
            using (SolidBrush haloBrush = new SolidBrush(Color.FromArgb(70, 255, 235, 59)))
            using (Pen haloPen = new Pen(Color.FromArgb(160, 255, 215, 0), 2))
            {
                int r = 24;
                g.FillEllipse(haloBrush, cx - r, cy - r, r * 2, r * 2);
                g.DrawEllipse(haloPen, cx - r, cy - r, r * 2, r * 2);
            }

            // Render click ripples (Left = Cyan, Right = Amber)
            lock (_clickEffects)
            {
                foreach (var eff in _clickEffects)
                {
                    int x = eff.X - this.Left;
                    int y = eff.Y - this.Top;
                    int a = (int)Math.Max(0, Math.Min(255, eff.Alpha));
                    Color color = eff.IsLeft ? Color.FromArgb(a, 0, 229, 255) : Color.FromArgb(a, 255, 152, 0);

                    using (Pen pen = new Pen(color, eff.IsLeft ? 3.5f : 4.5f))
                    {
                        g.DrawEllipse(pen, x - eff.Radius, y - eff.Radius, eff.Radius * 2, eff.Radius * 2);
                        if (!eff.IsLeft)
                        {
                            float innerR = Math.Max(2, eff.Radius - 12);
                            g.DrawEllipse(pen, x - innerR, y - innerR, innerR * 2, innerR * 2);
                        }
                    }
                }
            }

            // Render scroll wheel indicators (Cyan ▲ / ▼)
            lock (_scrollEffects)
            {
                foreach (var eff in _scrollEffects)
                {
                    int x = eff.X - this.Left + 28;
                    int y = (int)(eff.Y - this.Top + eff.OffsetY);
                    int a = (int)Math.Max(0, Math.Min(255, eff.Alpha));

                    using (SolidBrush bubbleBrush = new SolidBrush(Color.FromArgb(a, 15, 23, 42)))
                    using (SolidBrush textBrush = new SolidBrush(Color.FromArgb(a, 56, 189, 248)))
                    using (Font font = new Font("Segoe UI", 12, FontStyle.Bold))
                    {
                        g.FillEllipse(bubbleBrush, x - 12, y - 12, 24, 24);
                        string text = eff.IsUp ? "▲" : "▼";
                        g.DrawString(text, font, textBrush, x - 8, y - 11);
                    }
                }
            }
        }
    }
}
`;

export class MouseHighlightOverlay {
  private process: ChildProcess | null = null;

  start(): boolean {
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
        logger.info('[MouseHighlight] Launching precompiled mouse effect overlay.');
        this.process = spawn(exePath, [], { detached: true, stdio: 'ignore' });
        return true;
      }

      // PowerShell fallback compile & run script
      logger.info('[MouseHighlight] Launching mouse effect overlay via PowerShell fallback.');
      const psScript = `
$code = @"
${CSHARP_EFFECT_SOURCE}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies "System.Windows.Forms","System.Drawing","System.Core"
[GridSightOverlay.Program]::Main()
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
