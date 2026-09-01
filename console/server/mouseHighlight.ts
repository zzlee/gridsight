import { spawn, spawnSync, ChildProcess } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from './logger.js';

/*
 * C# source for the transparent WinForms overlay process with Low-Level Mouse Hook (WH_MOUSE_LL).
 * Optimized V2 Performance Architecture:
 * - Event-driven rendering: Animation timer only runs during active ripple/scroll effects (0 FPS idle).
 * - Dirty-region invalidation: Only repaints invalid bounding boxes rather than the entire virtual desktop.
 * - Cached GDI resources: Reuses Brushes, Pens, and Fonts to eliminate per-frame allocations.
 * - Queue capping: Limits concurrent click and scroll effects (MAX = 8) to prevent backlog spikes.
 * - Topmost, layered, click-through overlay (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_NOACTIVATE).
 */
export const CSHARP_EFFECT_SOURCE = `
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
        private const int WM_MOUSEMOVE = 0x0200;
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

                if (msg == WM_MOUSEMOVE)
                {
                    _form.UpdateCursorPosition(hookStruct.pt.x, hookStruct.pt.y);
                }
                else if (msg == WM_LBUTTONDOWN)
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

        private const int MAX_CLICK_EFFECTS = 8;
        private const int MAX_SCROLL_EFFECTS = 8;

        private readonly List<ClickEffect> _clickEffects = new List<ClickEffect>();
        private readonly List<ScrollEffect> _scrollEffects = new List<ScrollEffect>();
        private readonly Timer _timer;
        private readonly Timer _statsTimer;

        // Cached GDI Objects
        private readonly SolidBrush _haloBrush;
        private readonly Pen _haloPen;
        private readonly Pen _clickPen;
        private readonly SolidBrush _scrollBubbleBrush;
        private readonly SolidBrush _scrollTextBrush;
        private readonly Font _scrollFont;

        private Point _lastCursorPos = new Point(-9999, -9999);
        private Rectangle _lastHaloRect = Rectangle.Empty;

        // Telemetry
        private int _paintCount = 0;
        private int _mouseMoveCount = 0;
        private int _clickCount = 0;
        private int _scrollCount = 0;
        private int _animFrameCount = 0;

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

            // Initialize GDI resource cache
            _haloBrush = new SolidBrush(Color.FromArgb(70, 255, 235, 59));
            _haloPen = new Pen(Color.FromArgb(160, 255, 215, 0), 2);
            _clickPen = new Pen(Color.Cyan, 3.5f);
            _scrollBubbleBrush = new SolidBrush(Color.Black);
            _scrollTextBrush = new SolidBrush(Color.White);
            _scrollFont = new Font("Segoe UI", 12, FontStyle.Bold);

            // Animation Timer (Event-driven: default stopped)
            _timer = new Timer();
            _timer.Interval = 16; // ~60 FPS
            _timer.Tick += (s, e) => UpdateEffects();

            // Stats Telemetry Timer (5s interval)
            _statsTimer = new Timer();
            _statsTimer.Interval = 5000;
            _statsTimer.Tick += (s, e) => LogStats();
            _statsTimer.Start();
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

        public void UpdateCursorPosition(int screenX, int screenY)
        {
            int cx = screenX - this.Left;
            int cy = screenY - this.Top;
            if (cx == _lastCursorPos.X && cy == _lastCursorPos.Y) return;

            _mouseMoveCount++;
            Rectangle oldRect = _lastHaloRect;
            int r = 26; // halo radius 24 + 2 padding
            Rectangle newRect = new Rectangle(cx - r, cy - r, r * 2, r * 2);

            _lastCursorPos = new Point(cx, cy);
            _lastHaloRect = newRect;

            if (!oldRect.IsEmpty)
            {
                this.Invalidate(oldRect);
            }
            this.Invalidate(newRect);
        }

        public void AddClickEffect(int x, int y, bool isLeft)
        {
            _clickCount++;
            int cx = x - this.Left;
            int cy = y - this.Top;
            lock (_clickEffects)
            {
                if (_clickEffects.Count >= MAX_CLICK_EFFECTS)
                {
                    var oldest = _clickEffects[0];
                    int oldR = (int)Math.Ceiling(oldest.Radius) + 4;
                    this.Invalidate(new Rectangle(oldest.X - oldR, oldest.Y - oldR, oldR * 2, oldR * 2));
                    _clickEffects.RemoveAt(0);
                }

                var eff = new ClickEffect {
                    X = cx,
                    Y = cy,
                    IsLeft = isLeft,
                    Radius = 10,
                    MaxRadius = isLeft ? 45 : 55,
                    Alpha = 255
                };
                _clickEffects.Add(eff);
                int r = (int)Math.Ceiling(eff.Radius) + 4;
                this.Invalidate(new Rectangle(cx - r, cy - r, r * 2, r * 2));
            }

            EnsureTimerRunning();
        }

        public void AddScrollEffect(int x, int y, bool isUp)
        {
            _scrollCount++;
            int cx = x - this.Left + 28;
            int cy = y - this.Top;
            lock (_scrollEffects)
            {
                if (_scrollEffects.Count >= MAX_SCROLL_EFFECTS)
                {
                    var oldest = _scrollEffects[0];
                    int oldY = (int)(oldest.Y + oldest.OffsetY);
                    this.Invalidate(new Rectangle(oldest.X - 16, oldY - 16, 32, 32));
                    _scrollEffects.RemoveAt(0);
                }

                var eff = new ScrollEffect {
                    X = cx,
                    Y = cy,
                    IsUp = isUp,
                    Alpha = 255,
                    OffsetY = 0
                };
                _scrollEffects.Add(eff);
                this.Invalidate(new Rectangle(cx - 16, cy - 16, 32, 32));
            }

            EnsureTimerRunning();
        }

        private void EnsureTimerRunning()
        {
            if (!_timer.Enabled)
            {
                _timer.Start();
            }
        }

        private void UpdateEffects()
        {
            _animFrameCount++;
            bool hasActiveEffects = false;

            lock (_clickEffects)
            {
                for (int i = _clickEffects.Count - 1; i >= 0; i--)
                {
                    var eff = _clickEffects[i];
                    int prevR = (int)Math.Ceiling(eff.Radius) + 4;
                    Rectangle prevRect = new Rectangle(eff.X - prevR, eff.Y - prevR, prevR * 2, prevR * 2);

                    eff.Radius += 2.5f;
                    eff.Alpha -= 12f;

                    if (eff.Alpha <= 0 || eff.Radius >= eff.MaxRadius)
                    {
                        _clickEffects.RemoveAt(i);
                        this.Invalidate(prevRect);
                    }
                    else
                    {
                        int nextR = (int)Math.Ceiling(eff.Radius) + 4;
                        Rectangle nextRect = new Rectangle(eff.X - nextR, eff.Y - nextR, nextR * 2, nextR * 2);
                        this.Invalidate(Rectangle.Union(prevRect, nextRect));
                        hasActiveEffects = true;
                    }
                }
            }

            lock (_scrollEffects)
            {
                for (int i = _scrollEffects.Count - 1; i >= 0; i--)
                {
                    var eff = _scrollEffects[i];
                    int prevY = (int)(eff.Y + eff.OffsetY);
                    Rectangle prevRect = new Rectangle(eff.X - 16, prevY - 16, 32, 32);

                    eff.OffsetY += eff.IsUp ? -1.5f : 1.5f;
                    eff.Alpha -= 10f;

                    if (eff.Alpha <= 0)
                    {
                        _scrollEffects.RemoveAt(i);
                        this.Invalidate(prevRect);
                    }
                    else
                    {
                        int nextY = (int)(eff.Y + eff.OffsetY);
                        Rectangle nextRect = new Rectangle(eff.X - 16, nextY - 16, 32, 32);
                        this.Invalidate(Rectangle.Union(prevRect, nextRect));
                        hasActiveEffects = true;
                    }
                }
            }

            if (!hasActiveEffects)
            {
                _timer.Stop();
            }
        }

        private void LogStats()
        {
            Console.WriteLine(string.Format("[MouseHighlight Stats] paint={0} mouseMove={1} click={2} scroll={3} animFrames={4} activeClick={5} activeScroll={6}",
                _paintCount, _mouseMoveCount, _clickCount, _scrollCount, _animFrameCount, _clickEffects.Count, _scrollEffects.Count));
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            _paintCount++;
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            Point cursorPt = Cursor.Position;
            int cx = cursorPt.X - this.Left;
            int cy = cursorPt.Y - this.Top;

            // Yellow semi-transparent halo around mouse cursor
            int r = 24;
            g.FillEllipse(_haloBrush, cx - r, cy - r, r * 2, r * 2);
            g.DrawEllipse(_haloPen, cx - r, cy - r, r * 2, r * 2);

            // Render click ripples (Left = Cyan, Right = Amber)
            lock (_clickEffects)
            {
                foreach (var eff in _clickEffects)
                {
                    int a = (int)Math.Max(0, Math.Min(255, eff.Alpha));
                    Color color = eff.IsLeft ? Color.FromArgb(a, 0, 229, 255) : Color.FromArgb(a, 255, 152, 0);
                    _clickPen.Color = color;
                    _clickPen.Width = eff.IsLeft ? 3.5f : 4.5f;

                    g.DrawEllipse(_clickPen, eff.X - eff.Radius, eff.Y - eff.Radius, eff.Radius * 2, eff.Radius * 2);
                    if (!eff.IsLeft)
                    {
                        float innerR = Math.Max(2, eff.Radius - 12);
                        g.DrawEllipse(_clickPen, eff.X - innerR, eff.Y - innerR, innerR * 2, innerR * 2);
                    }
                }
            }

            // Render scroll wheel indicators (Cyan ▲ / ▼)
            lock (_scrollEffects)
            {
                foreach (var eff in _scrollEffects)
                {
                    int x = eff.X;
                    int y = (int)(eff.Y + eff.OffsetY);
                    int a = (int)Math.Max(0, Math.Min(255, eff.Alpha));

                    _scrollBubbleBrush.Color = Color.FromArgb(a, 15, 23, 42);
                    _scrollTextBrush.Color = Color.FromArgb(a, 56, 189, 248);

                    g.FillEllipse(_scrollBubbleBrush, x - 12, y - 12, 24, 24);
                    string text = eff.IsUp ? "▲" : "▼";
                    g.DrawString(text, _scrollFont, _scrollTextBrush, x - 8, y - 11);
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _timer?.Dispose();
                _statsTimer?.Dispose();
                _haloBrush?.Dispose();
                _haloPen?.Dispose();
                _clickPen?.Dispose();
                _scrollBubbleBrush?.Dispose();
                _scrollTextBrush?.Dispose();
                _scrollFont?.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
`;

function findOverlayBinary(): string | null {
  const candidates = [
    path.join(process.cwd(), 'bin', 'GridSightMouseOverlay.exe'),
    path.join(process.cwd(), 'bin', 'gs-mouse-overlay.exe'),
    path.join(path.dirname(process.execPath), 'bin', 'GridSightMouseOverlay.exe'),
    path.join(path.dirname(process.execPath), 'GridSightMouseOverlay.exe'),
    path.join(os.tmpdir(), 'GridSightMouseOverlay.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findCscCompiler(): string | null {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework64\\v3.5\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v3.5\\csc.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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
      // 1. Check if precompiled standalone native binary exists (0ms startup delay)
      const bundledExe = findOverlayBinary();
      if (bundledExe && fs.existsSync(bundledExe)) {
        logger.info(`[MouseHighlight] Launching precompiled native mouse overlay: ${bundledExe}`);
        this.process = spawn(bundledExe, [], { detached: true, stdio: 'ignore' });
        return true;
      }

      const tempDir = os.tmpdir();
      const csPath = path.join(tempDir, 'GridSightMouseOverlay.cs');
      const exePath = path.join(tempDir, 'GridSightMouseOverlay.exe');

      fs.writeFileSync(csPath, CSHARP_EFFECT_SOURCE, 'utf-8');

      // 2. Synchronously compile C# overlay on-the-fly via detected csc.exe
      const cscPath = findCscCompiler();
      if (cscPath && fs.existsSync(cscPath) && !fs.existsSync(exePath)) {
        logger.info(`[MouseHighlight] Compiling C# mouse overlay using ${cscPath}...`);
        const res = spawnSync(cscPath, ['/target:winexe', `/out:${exePath}`, csPath], { windowsHide: true });
        if (res.status === 0 && fs.existsSync(exePath)) {
          logger.info('[MouseHighlight] Mouse effect overlay compiled successfully.');
        } else {
          logger.warn(`[MouseHighlight] csc compilation failed with code ${res.status}`);
        }
      }

      if (fs.existsSync(exePath)) {
        logger.info('[MouseHighlight] Launching compiled mouse effect overlay.');
        this.process = spawn(exePath, [], { detached: true, stdio: 'ignore' });
        return true;
      }

      // 3. PowerShell fallback compile & run script
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
