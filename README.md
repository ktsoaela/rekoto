# Loom Clone

A local, private screen recorder for Windows, built with Electron. It records your screen, a single window or app, or just your camera, with a round camera bubble of you. Videos are saved as MP4 files on your PC, and there is a library to watch them.

Nothing is uploaded. There are no accounts and no cloud.

## Features

- **Record the full screen, one window or app, or camera only.** Microphone and system audio are optional, with a mic level meter.
- **Rounded camera bubble.** It is draggable and has four sizes (hover it to change the size). The bubble on your screen is hidden from the capture, and the app draws the camera into the video at the same spot.
- **Studio background.** The captured window is placed on your branded background: a gradient, a solid colour or your own image, plus an optional company logo and caption. The real wallpaper and other apps never appear in the video.
- **Clean desktop mode (Windows).** While recording, it swaps the wallpaper for your studio background, hides desktop icons, minimizes other apps and can hide the taskbar. You can pick windows to keep visible. Everything is restored when you stop. If the app crashes, it is restored the next time the app starts.
- **Browser privacy (Chrome, Edge, Firefox extensions):**
  - Masks password fields, one-time codes and card numbers while recording. A field stays masked even after a "show password" toggle turns it into plain text.
  - Crops out the tabs, address bar and bookmarks bar, so only the web page is in the video.
  - Lets you start, pause and stop a recording of the current browser window from the toolbar button.
- **Floating controls.** A timer plus pause, stop and discard buttons. They never appear in the recording. Shortcuts: `Alt+Shift+S` stops, `Alt+Shift+P` pauses or resumes, `Alt+Shift+C` discards.
- **Library.** Thumbnails, durations, search, an in-app player, rename, show in folder, and delete (moves the file to the Recycle Bin).
- **Save folder.** The default is `Videos\Loom Clone`. You can change it in Settings or from the Library header.

## Getting started

```bash
npm install
npm run dev        # run in development
npm run build      # build the app bundles into out/
npm run dist       # build a Windows installer into dist/
```

If `npm install` did not download Electron, run `node node_modules/electron/install.js`.

## Installing the browser extensions

When the app starts, it registers its native-messaging "browser connection" for Chrome, Edge and Firefox (current user only). You can check its status in **Settings → Browser privacy**.

- **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click **Load unpacked** and select `extensions/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and select `extensions/firefox/manifest.json`.

The extension's toolbar popup shows whether the desktop app is connected. The shared extension source is in `extensions/shared`. After editing it, run `npm run build:ext`.

## How it works

```
Browser extension ──native messaging──> host.js ──named pipe──> Electron main
                                                                     │
   screen/window ─┐                                                  ├─ clean desktop (PowerShell + Win32)
   camera ────────┼─> compositor (background → cropped frame → round camera)
   background ────┘          │
                       MediaRecorder ──chunks──> temp file ──ffmpeg──> MP4 in your save folder ──> library
```

- `src/main/recording.ts`: the recording session, plus the bubble, controls, countdown and recorder windows.
- `src/main/clean-desktop.ts`: wallpaper, desktop icons, taskbar and window minimizing, with crash-safe restore.
- `src/main/native-bridge.ts`: the named-pipe server, plus native-host registration for each browser.
- `src/main/library.ts` and `src/main/ffmpeg.ts`: listing videos, thumbnails, duration and MP4 conversion.
- `src/renderer/src/studio/`: the compositor and the studio background renderer.
- `native-host/host.js`: the native-messaging host, run with Electron's bundled Node.
- `extensions/`: the Chrome (MV3) and Firefox (MV3) extensions.

### Notes

- Hardware video encoding is turned off by default. On some Windows GPU drivers it makes MediaRecorder hang without producing any data. To try hardware encoding, set `LC_HW_ENCODE=1`.
- The overlay windows (camera bubble, controls, countdown) are excluded from capture with `setContentProtection`. This needs Windows 10 version 2004 or later.
- Password masking covers normal page inputs. Fields inside closed shadow DOMs, or drawn by a password manager in its own window, are not masked. Use clean-desktop mode to minimize those windows.
