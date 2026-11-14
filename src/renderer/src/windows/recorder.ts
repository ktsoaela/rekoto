import type { Layout, RecorderConfig } from '@shared/types'
import { Compositor } from '../studio/Compositor'
import { renderBackground } from '../studio/background'
import { FrameSource } from '../studio/frames'

const api = window.api
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2)

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/x-matroska;codecs=avc1,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

export async function runRecorder(): Promise<void> {
  const streams: MediaStream[] = []
  const sources: FrameSource[] = []
  try {
    const cfg = await api.invoke<RecorderConfig>('recorder:config')
    const { options, settings } = cfg
    let layout: Layout = cfg.layout

    let screenStream: MediaStream | null = null
    if (options.mode !== 'camera') {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: settings.fps },
          audio: options.systemAudio
        })
      } catch (e) {
        if (!options.systemAudio) throw e
        // System audio can fail on some drivers; retry with video only.
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: settings.fps }, audio: false })
      }
      streams.push(screenStream)
    }

    const camStream = options.camera
      ? await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: settings.cameraDeviceId ? { exact: settings.cameraDeviceId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        })
      : null
    if (camStream) streams.push(camStream)

    const micStream = options.mic
      ? await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: settings.micDeviceId ? { exact: settings.micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
      : null
    if (micStream) streams.push(micStream)

    const screenSrc = screenStream ? new FrameSource(screenStream.getVideoTracks()[0]) : null
    const camSrc = camStream ? new FrameSource(camStream.getVideoTracks()[0]) : null
    for (const s of [screenSrc, camSrc]) if (s) sources.push(s)
    await Promise.all(sources.map((s) => s.start()))

    const H = settings.resolution
    let W = even((H * 16) / 9)
    if (screenSrc && !options.studio) {
      const c = layout.crop
      const aspect = (screenSrc.width * (c?.w ?? 1)) / (screenSrc.height * (c?.h ?? 1))
      W = even(Math.min(3840, H * aspect))
    }

    const background = await renderBackground(settings.background, W, H)
    const comp = new Compositor({
      width: W,
      height: H,
      fps: settings.fps,
      mode: options.mode,
      studio: options.studio,
      padding: settings.studioPadding,
      radius: settings.cornerRadius,
      background,
      screen: screenSrc,
      camera: camSrc,
      layout,
      onFrame: () => videoTrack.requestFrame()
    })
    api.on('recorder:layout', (l) => {
      layout = l as Layout
      comp.layout = layout
    })
    // Output frames are pushed explicitly after each composite, so the cadence follows the compositor.
    document.body.appendChild(comp.canvas)
    const out = comp.canvas.captureStream(0)
    const videoTrack = out.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    comp.hold = true
    comp.start()

    const audioStreams = [screenStream, micStream].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0)
    let audioCtx: AudioContext | null = null
    if (audioStreams.length) {
      audioCtx = new AudioContext({ sampleRate: 48000 })
      await audioCtx.resume()
      const dest = audioCtx.createMediaStreamDestination()
      for (const s of audioStreams) audioCtx.createMediaStreamSource(s).connect(dest)
      for (const t of dest.stream.getAudioTracks()) out.addTrack(t)
    }

    const mimeType = pickMime()
    const rec = new MediaRecorder(out, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: H >= 1440 ? 16_000_000 : H >= 1080 ? 9_000_000 : 5_000_000,
      audioBitsPerSecond: 160_000
    })

    let chain = Promise.resolve()
    rec.ondataavailable = (e) => {
      if (!e.data.size) return
      const blob = e.data
      chain = chain.then(async () => {
        await api.invoke('recorder:chunk', await blob.arrayBuffer())
      })
    }
    const cleanup = (): void => {
      comp.stop()
      for (const s of sources) s.stop()
      for (const s of streams) s.getTracks().forEach((t) => t.stop())
      void audioCtx?.close()
    }
    rec.onstop = async () => {
      await chain
      cleanup()
      await api.invoke('recorder:finished')
    }
    // Warm-up: the encoder starts during the countdown on a held brand frame, then pauses.
    // "begin" only flips the hold and resumes, so recording starts the instant the countdown ends.
    let begun = false
    let encoderUp = false
    rec.onstart = () => {
      encoderUp = true
      if (begun) comp.hold = false
      else if (rec.state === 'recording') rec.pause()
      void api.invoke('recorder:started')
    }
    rec.onerror = (e) => void api.invoke('recorder:error', `MediaRecorder error: ${String((e as unknown as { error?: Error }).error ?? e)}`)

    // If the captured window closes or the user ends sharing, stop gracefully.
    screenStream?.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (rec.state !== 'inactive') void api.invoke('controls:action', 'stop')
    })

    api.on('recorder:command', (cmd) => {
      if (cmd === 'begin') {
        begun = true
        if (rec.state === 'inactive') rec.start(1000)
        if (encoderUp) {
          comp.hold = false
          if (rec.state === 'paused') rec.resume()
        }
      }
      else if (cmd === 'pause' && rec.state === 'recording') rec.pause()
      else if (cmd === 'resume' && rec.state === 'paused') rec.resume()
      else if (cmd === 'stop' || cmd === 'cancel') {
        if (rec.state !== 'inactive') rec.stop()
        else {
          cleanup()
          void api.invoke('recorder:finished')
        }
      }
    })

    rec.start(1000)
    await api.invoke('recorder:ready', rec.mimeType || mimeType)
  } catch (e) {
    for (const s of sources) s.stop()
    for (const s of streams) s.getTracks().forEach((t) => t.stop())
    const err = e as Error
    const msg =
      err.name === 'NotAllowedError'
        ? 'Permission denied for screen, camera or microphone.'
        : err.name === 'NotFoundError' || err.name === 'OverconstrainedError'
          ? 'The selected camera or microphone was not found. Pick another device in Settings.'
          : err.name === 'NotReadableError'
            ? 'The camera or microphone is in use by another app.'
            : err.message || String(e)
    await api.invoke('recorder:error', msg)
  }
}
