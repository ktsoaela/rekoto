import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { CleanDesktopConfig } from '@shared/types'

/**
 * Clean desktop mode (Windows): swap the wallpaper, hide desktop icons and the taskbar, and
 * minimize other windows while recording. The previous state is written to disk before anything
 * changes so it can be restored after a crash on the next launch.
 */

export interface CleanState {
  wallpaper: { path: string; style: string; tile: string } | null
  iconsHidden: boolean
  taskbarHidden: boolean
  minimized: number[]
}

const PS_SCRIPT = String.raw`
param([string]$Action, [string]$ArgsFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LcDesk {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SystemParametersInfo(uint a, uint b, string c, uint d);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string c, string w);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);

  public static bool SetWallpaper(string path) { return SystemParametersInfo(0x14, 0, path, 3); }

  static IntPtr Icons() {
    IntPtr defView = FindWindowEx(FindWindow("Progman", null), IntPtr.Zero, "SHELLDLL_DefView", null);
    if (defView == IntPtr.Zero) {
      IntPtr w = IntPtr.Zero;
      while ((w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero) {
        defView = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (defView != IntPtr.Zero) break;
      }
    }
    if (defView == IntPtr.Zero) return IntPtr.Zero;
    return FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
  }
  public static bool SetIcons(bool show) {
    IntPtr lv = Icons();
    if (lv == IntPtr.Zero) return false;
    ShowWindow(lv, show ? 5 : 0);
    return true;
  }
  public static bool SetTaskbar(bool show) {
    IntPtr t = FindWindow("Shell_TrayWnd", null);
    if (t == IntPtr.Zero) return false;
    ShowWindow(t, show ? 5 : 0);
    IntPtr s = IntPtr.Zero;
    while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) ShowWindow(s, show ? 5 : 0);
    return true;
  }
  public static long[] MinimizeOthers(long[] keepPids, long[] keepHwnds) {
    var keepP = new HashSet<long>(keepPids);
    var keepH = new HashSet<long>(keepHwnds);
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      int ex = GetWindowLong(h, -20);
      if ((ex & 0x80) != 0) return true;
      if (GetWindowTextLength(h) == 0) return true;
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256);
      string cls = sb.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (keepP.Contains(pid) || keepH.Contains(h.ToInt64())) return true;
      list.Add(h);
      return true;
    }, IntPtr.Zero);
    var done = new List<long>();
    foreach (var h in list) { ShowWindow(h, 6); done.Add(h.ToInt64()); }
    return done.ToArray();
  }
  public static void Restore(long[] hwnds) {
    for (int i = hwnds.Length - 1; i >= 0; i--) {
      IntPtr h = new IntPtr(hwnds[i]);
      if (IsWindow(h) && IsIconic(h)) ShowWindow(h, 9);
    }
  }
}
'@
$a = Get-Content -Raw -LiteralPath $ArgsFile | ConvertFrom-Json
$desk = 'HKCU:\Control Panel\Desktop'
if ($Action -eq 'apply') {
  $state = [ordered]@{ wallpaper = $null; iconsHidden = $false; taskbarHidden = $false; minimized = @() }
  if ($a.wallpaper) {
    $p = Get-ItemProperty -Path $desk
    $state.wallpaper = [ordered]@{ path = [string]$p.WallPaper; style = [string]$p.WallpaperStyle; tile = [string]$p.TileWallpaper }
    Set-ItemProperty -Path $desk -Name WallpaperStyle -Value '10'
    Set-ItemProperty -Path $desk -Name TileWallpaper -Value '0'
    [void][LcDesk]::SetWallpaper([string]$a.wallpaper)
  }
  if ($a.hideIcons) { $state.iconsHidden = [LcDesk]::SetIcons($false) }
  if ($a.hideTaskbar) { $state.taskbarHidden = [LcDesk]::SetTaskbar($false) }
  if ($a.minimize) {
    $pids = [long[]]@($a.keepPids | ForEach-Object { [long]$_ })
    $hw = [long[]]@($a.keepHwnds | ForEach-Object { [long]$_ })
    $state.minimized = @([LcDesk]::MinimizeOthers($pids, $hw))
  }
  $state | ConvertTo-Json -Compress -Depth 4
} elseif ($Action -eq 'restore') {
  if ($a.wallpaper) {
    Set-ItemProperty -Path $desk -Name WallpaperStyle -Value ([string]$a.wallpaper.style)
    Set-ItemProperty -Path $desk -Name TileWallpaper -Value ([string]$a.wallpaper.tile)
    [void][LcDesk]::SetWallpaper([string]$a.wallpaper.path)
  }
  if ($a.iconsHidden) { [void][LcDesk]::SetIcons($true) }
  if ($a.taskbarHidden) { [void][LcDesk]::SetTaskbar($true) }
  if ($a.minimized) { [LcDesk]::Restore([long[]]@($a.minimized | ForEach-Object { [long]$_ })) }
  '{"ok":true}'
}
`

const dir = (): string => path.join(app.getPath('userData'), 'clean-desktop')
const stateFile = (): string => path.join(dir(), 'restore-state.json')

function runPs(action: 'apply' | 'restore', args: unknown): Promise<string> {
  fs.mkdirSync(dir(), { recursive: true })
  const script = path.join(dir(), 'desk.ps1')
  fs.writeFileSync(script, PS_SCRIPT, 'utf8')
  const argsFile = path.join(dir(), `${action}-args.json`)
  fs.writeFileSync(argsFile, JSON.stringify(args), 'utf8')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-ArgsFile', argsFile],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve(stdout.trim())
      }
    )
  })
}

export function isSupported(): boolean {
  return process.platform === 'win32'
}

export async function applyCleanDesktop(
  cfg: CleanDesktopConfig,
  wallpaperPath: string | null,
  keepHwnds: number[]
): Promise<CleanState | null> {
  if (!isSupported()) return null
  // Mark that a change is in progress so a crash mid-apply still triggers a restore attempt.
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify({ wallpaper: null, iconsHidden: cfg.hideIcons, taskbarHidden: cfg.hideTaskbar, minimized: [] }))
  const out = await runPs('apply', {
    wallpaper: cfg.wallpaper && wallpaperPath && fs.existsSync(wallpaperPath) ? wallpaperPath : null,
    hideIcons: cfg.hideIcons,
    hideTaskbar: cfg.hideTaskbar,
    minimize: cfg.minimizeWindows,
    keepPids: [process.pid],
    keepHwnds
  })
  const state = JSON.parse(out.split(/\r?\n/).pop() || '{}') as CleanState
  state.minimized = Array.isArray(state.minimized) ? state.minimized : state.minimized ? [state.minimized as unknown as number] : []
  fs.writeFileSync(stateFile(), JSON.stringify(state))
  return state
}

export async function restoreCleanDesktop(state?: CleanState | null): Promise<void> {
  if (!isSupported()) return
  let s = state ?? null
  if (!s) {
    try {
      s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    } catch {
      return
    }
  }
  try {
    await runPs('restore', s)
  } finally {
    fs.rmSync(stateFile(), { force: true })
  }
}

export function hasPendingRestore(): boolean {
  return fs.existsSync(stateFile())
}

export const wallpaperFile = (): string => path.join(app.getPath('userData'), 'studio-wallpaper.png')
