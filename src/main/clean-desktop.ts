import { app } from 'electron'
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { CleanDesktopConfig } from '@shared/types'

/**
 * Clean desktop mode (Windows): swap the wallpaper, hide desktop icons and the taskbar, and
 * minimize other windows while recording.
 *
 * Speed: a single PowerShell process is started when the app launches and keeps the Win32 helper
 * type compiled, so apply/restore take tens of milliseconds instead of seconds.
 *
 * Safety: the user's wallpaper FILE is copied to a backup before anything changes. Windows
 * overwrites its own "TranscodedWallpaper" copy when a new wallpaper is set, so restoring from the
 * registry path alone would bring back our studio wallpaper instead of the user's.
 */

export interface CleanState {
  wallpaper: { path: string; style: string; tile: string; source?: string } | null
  iconsHidden: boolean
  taskbarHidden: boolean
  minimized: number[]
}

const PS_HEADER = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
if (-not ('LcDesk' -as [type])) {
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
}
$desk = 'HKCU:\Control Panel\Desktop'

function Save-State([object]$state, [string]$StateFile) {
  if ($StateFile) {
    # No BOM: the app parses this file with JSON.parse.
    [IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Compress -Depth 5), (New-Object System.Text.UTF8Encoding $false))
  }
}

function Test-Ours([string]$p) { return ($p -and ($p -like '*studio-wallpaper*')) }

function Invoke-Apply($a, [string]$StateFile, [string]$BackupDir) {
  $state = [ordered]@{ wallpaper = $null; iconsHidden = $false; taskbarHidden = $false; minimized = @() }
  if ($a.wallpaper) {
    $p = Get-ItemProperty -Path $desk
    $cur = [string]$p.WallPaper
    $meta = Join-Path $BackupDir 'original-wallpaper.json'
    if (Test-Ours $cur) {
      # A previous restore did not finish: our wallpaper is still set. Use the saved original.
      if (Test-Path -LiteralPath $meta) {
        $m = [IO.File]::ReadAllText($meta) | ConvertFrom-Json
        $state.wallpaper = [ordered]@{ path = [string]$m.path; style = [string]$m.style; tile = [string]$m.tile; source = [string]$m.source }
      } else {
        $state.wallpaper = [ordered]@{ path = ''; style = '10'; tile = '0'; source = '' }
      }
    } else {
      $backup = ''
      if ($cur -and (Test-Path -LiteralPath $cur)) {
        $ext = [IO.Path]::GetExtension($cur)
        if (-not $ext) { $ext = '.jpg' }
        Get-ChildItem -LiteralPath $BackupDir -Filter 'original-wallpaper.*' -ErrorAction SilentlyContinue | Where-Object { $_.Extension -ne '.json' } | Remove-Item -Force -ErrorAction SilentlyContinue
        $backup = Join-Path $BackupDir ('original-wallpaper' + $ext)
        Copy-Item -LiteralPath $cur -Destination $backup -Force
      }
      $state.wallpaper = [ordered]@{ path = $backup; style = [string]$p.WallpaperStyle; tile = [string]$p.TileWallpaper; source = $cur }
      [IO.File]::WriteAllText($meta, ($state.wallpaper | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding $false))
    }
  }
  if ($a.hideIcons) { $state.iconsHidden = $true }
  if ($a.hideTaskbar) { $state.taskbarHidden = $true }
  # Snapshot BEFORE changing anything so a crash mid-apply still restores the user's desktop.
  Save-State $state $StateFile

  if ($a.wallpaper) {
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
  Save-State $state $StateFile
  return $state
}

function Invoke-Restore($a) {
  if ($a.wallpaper) {
    $target = [string]$a.wallpaper.path
    $src = [string]$a.wallpaper.source
    # Prefer the user's real file when it still exists (keeps Settings > Personalization accurate).
    if ($src -and ($src -notlike '*TranscodedWallpaper*') -and -not (Test-Ours $src) -and (Test-Path -LiteralPath $src)) { $target = $src }
    if ($target -and -not (Test-Path -LiteralPath $target)) { $target = '' }
    $style = [string]$a.wallpaper.style; if (-not $style) { $style = '10' }
    $tile = [string]$a.wallpaper.tile; if (-not $tile) { $tile = '0' }
    Set-ItemProperty -Path $desk -Name WallpaperStyle -Value $style
    Set-ItemProperty -Path $desk -Name TileWallpaper -Value $tile
    # Empty path = the user had a solid colour background.
    [void][LcDesk]::SetWallpaper($target)
  }
  if ($a.iconsHidden) { [void][LcDesk]::SetIcons($true) }
  if ($a.taskbarHidden) { [void][LcDesk]::SetTaskbar($true) }
  if ($a.minimized) { [LcDesk]::Restore([long[]]@($a.minimized | ForEach-Object { [long]$_ })) }
  return @{ ok = $true }
}

# Windows built-in OCR (Windows.Media.Ocr). Loaded on first use.
$script:ocrReady = $false
function Invoke-Ocr([string]$Path) {
  if (-not $script:ocrReady) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' -and $_.GetParameters()[0].ParameterType.Name -notlike '*Progress*' })[0]
    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $script:ocrReady = $true
  }
  function Await($op, [Type]$t) { $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op)); [void]$task.Wait(-1); $task.Result }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) { throw 'No Windows OCR language is installed. Add one in Settings > Time & language > Language.' }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    return @{ text = (($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine) }
  } finally {
    $stream.Dispose()
  }
}
`

const ONE_SHOT_SCRIPT = String.raw`
param([string]$Action, [string]$ArgsFile, [string]$StateFile, [string]$BackupDir)
` + PS_HEADER + String.raw`
$a = [IO.File]::ReadAllText($ArgsFile) | ConvertFrom-Json
if ($Action -eq 'apply') { Invoke-Apply $a $StateFile $BackupDir | ConvertTo-Json -Compress -Depth 5 }
elseif ($Action -eq 'restore') { Invoke-Restore $a | Out-Null; '{"ok":true}' }
elseif ($Action -eq 'ocr') { Invoke-Ocr ([string]$a.path) | ConvertTo-Json -Compress }
`

const SERVER_SCRIPT = PS_HEADER + String.raw`
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    if ($req.action -eq 'apply') { $res = Invoke-Apply $req.args ([string]$req.stateFile) ([string]$req.backupDir) }
    elseif ($req.action -eq 'restore') { $res = Invoke-Restore $req.args }
    elseif ($req.action -eq 'ocr') { $res = Invoke-Ocr ([string]$req.args.path) }
    else { $res = @{ pong = $true } }
    $o = [ordered]@{ id = $id; ok = $true; result = $res }
  } catch {
    $o = [ordered]@{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`

const dir = (): string => path.join(app.getPath('userData'), 'clean-desktop')
const stateFile = (): string => path.join(dir(), 'restore-state.json')

function writeScript(name: string, body: string): string {
  fs.mkdirSync(dir(), { recursive: true })
  const p = path.join(dir(), name)
  try {
    if (fs.readFileSync(p, 'utf8') === body) return p
  } catch {
    /* write below */
  }
  fs.writeFileSync(p, body, 'utf8')
  return p
}

/** Non-ASCII safe JSON for PowerShell stdin. */
function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

type Action = 'apply' | 'restore' | 'ocr'

// ---------- persistent PowerShell helper ----------

let server: ChildProcessWithoutNullStreams | null = null
let serverReady: Promise<boolean> | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

/** Starts the helper in the background. Call once at app launch so the first recording is fast. */
export function warmCleanDesktop(): void {
  if (!isSupported() || server) return
  const script = writeScript('desk-server.ps1', SERVER_SCRIPT)
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true
  })
  server = proc
  let buf = ''
  serverReady = new Promise<boolean>((resolveReady) => {
    const timer = setTimeout(() => resolveReady(false), 20_000)
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line.startsWith('{')) continue
        try {
          const msg = JSON.parse(line) as { ready?: boolean; id?: number; ok?: boolean; result?: unknown; error?: string }
          if (msg.ready) {
            clearTimeout(timer)
            resolveReady(true)
            continue
          }
          const w = msg.id != null ? waiting.get(msg.id) : undefined
          if (!w) continue
          waiting.delete(msg.id!)
          if (msg.ok) w.resolve(msg.result)
          else w.reject(new Error(msg.error || 'clean desktop helper failed'))
        } catch {
          /* ignore partial/foreign output */
        }
      }
    })
    proc.on('exit', () => {
      clearTimeout(timer)
      resolveReady(false)
    })
  })
  proc.stderr.on('data', () => undefined)
  proc.on('exit', () => {
    for (const w of waiting.values()) w.reject(new Error('clean desktop helper exited'))
    waiting.clear()
    if (server === proc) {
      server = null
      serverReady = null
    }
  })
}

export function stopCleanDesktopHelper(): void {
  try {
    server?.stdin.end()
    server?.kill()
  } catch {
    /* already gone */
  }
  server = null
  serverReady = null
}

async function viaServer(action: Action, args: unknown, extra: Record<string, string>): Promise<unknown | undefined> {
  if (!server) warmCleanDesktop()
  const ready = serverReady ? await serverReady : false
  const proc = server
  if (!ready || !proc) return undefined
  const id = nextId++
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiting.delete(id)
      reject(new Error('clean desktop helper timed out'))
    }, action === 'restore' ? 45_000 : 15_000)
    waiting.set(id, {
      resolve: (v) => {
        clearTimeout(t)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(t)
        reject(e)
      }
    })
    proc.stdin.write(asciiJson({ id, action, args, ...extra }) + '\n')
  })
}

function viaOneShot(action: Action, args: unknown): Promise<string> {
  const script = writeScript('desk.ps1', ONE_SHOT_SCRIPT)
  const argsFile = path.join(dir(), `${action}-args.json`)
  fs.writeFileSync(argsFile, JSON.stringify(args), 'utf8')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-ArgsFile', argsFile, '-StateFile', stateFile(), '-BackupDir', dir()],
      { windowsHide: true, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve(stdout.trim())
      }
    )
  })
}

async function run(action: Action, args: unknown): Promise<unknown> {
  const extra = { stateFile: stateFile(), backupDir: dir() }
  try {
    const r = await viaServer(action, args, extra)
    if (r !== undefined) return r
  } catch (e) {
    console.error('clean desktop helper failed, falling back', e)
    // A slow (not dead) helper is still the fastest option: don't start a competing PowerShell.
    // Restores always fall back: the user's desktop must come back no matter what.
    if (action === 'apply' && server && /timed out/.test(String(e))) throw e
  }
  const out = await viaOneShot(action, args)
  return JSON.parse(out.split(/\r?\n/).filter(Boolean).pop() || '{}')
}

// ---------- state ----------

function normalizeState(raw: CleanState): CleanState {
  const minimized = Array.isArray(raw.minimized) ? raw.minimized : raw.minimized ? [raw.minimized as unknown as number] : []
  return {
    wallpaper: raw.wallpaper ?? null,
    iconsHidden: !!raw.iconsHidden,
    taskbarHidden: !!raw.taskbarHidden,
    minimized
  }
}

function readStateFile(): CleanState | null {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(stateFile(), 'utf8').replace(/^﻿/, '')) as CleanState)
  } catch {
    return null
  }
}

/** Old state files (before backups existed) may lack a usable path; recover from Windows history. */
function repairMissingWallpaper(state: CleanState): CleanState {
  if (!state.wallpaper || state.wallpaper.path || state.wallpaper.source !== undefined) return state
  try {
    const prev = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          "$hist = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Wallpapers' -ErrorAction SilentlyContinue",
          'if ($hist) {',
          "  foreach ($k in 'BackgroundHistoryPath0','BackgroundHistoryPath1','BackgroundHistoryPath2','BackgroundHistoryPath3') {",
          '    $p = [string]$hist.$k',
          "    if ($p -and $p -notlike '*studio-wallpaper*' -and (Test-Path -LiteralPath $p)) { Write-Output $p; break }",
          '  }',
          '}'
        ].join('; ')
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 }
    ).trim()
    return prev ? { ...state, wallpaper: { path: prev, style: state.wallpaper.style || '10', tile: state.wallpaper.tile || '0' } } : state
  } catch {
    return state
  }
}

export function isSupported(): boolean {
  return process.platform === 'win32'
}

export async function applyCleanDesktop(cfg: CleanDesktopConfig, wallpaperPath: string | null, keepHwnds: number[]): Promise<CleanState | null> {
  if (!isSupported()) return null
  fs.mkdirSync(dir(), { recursive: true })
  try {
    const raw = await run('apply', {
      wallpaper: cfg.wallpaper && wallpaperPath && fs.existsSync(wallpaperPath) ? wallpaperPath : null,
      hideIcons: cfg.hideIcons,
      hideTaskbar: cfg.hideTaskbar,
      minimize: cfg.minimizeWindows,
      keepPids: [process.pid],
      keepHwnds
    })
    const state = normalizeState(raw as CleanState)
    fs.writeFileSync(stateFile(), JSON.stringify(state))
    return state
  } catch (e) {
    // Apply may have partially changed the desktop; restore from whatever was snapshotted.
    try {
      await restoreCleanDesktop()
    } catch (restoreErr) {
      console.error('clean desktop rollback failed', restoreErr)
    }
    throw e
  }
}

export async function restoreCleanDesktop(state?: CleanState | null): Promise<void> {
  if (!isSupported()) return
  let s = state ? normalizeState(state) : readStateFile()
  if (!s) return
  s = repairMissingWallpaper(s)
  try {
    await run('restore', s)
  } finally {
    fs.rmSync(stateFile(), { force: true })
  }
}

export function hasPendingRestore(): boolean {
  return fs.existsSync(stateFile())
}

/** Recognise text in an image file with the Windows OCR engine. */
export async function ocrImage(file: string): Promise<string> {
  if (!isSupported()) throw new Error('Text extraction needs Windows 10 or later')
  const r = (await run('ocr', { path: file })) as { text?: string }
  return r?.text ?? ''
}

export const wallpaperFile = (): string => path.join(app.getPath('userData'), 'studio-wallpaper.png')
