import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureMode, Settings, SourceInfo, StartOptions } from '@shared/types'
import { exportWallpaper, useDevices } from '../devices'
import BackgroundPreview from '../components/BackgroundPreview'
import Icon from '../components/Icon'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
  busy: boolean
  /** True once frames are being recorded; device previews close then (not during the countdown). */
  capturing: boolean
}

interface AppInfo {
  cleanDesktopSupported: boolean
  ffmpeg: boolean
}

const MODES: Array<{ id: CaptureMode; title: string; icon: string }> = [
  { id: 'screen', title: 'Full screen', icon: 'monitor' },
  { id: 'window', title: 'Window', icon: 'window' },
  { id: 'camera', title: 'Camera only', icon: 'camera' }
]

export default function Record({ settings, update, busy, capturing }: Props) {
  const [mode, setMode] = useState<CaptureMode>(settings.lastMode)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [keep, setKeep] = useState<string[]>([])
  const [studio, setStudio] = useState(settings.lastMode === 'window' ? settings.studioForWindow : settings.studioForScreen)
  const [clean, setClean] = useState(settings.cleanDesktopEnabled)
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const devices = useDevices()

  const loadSources = useCallback(async () => {
    const list = await window.api.invoke<SourceInfo[]>('sources:list')
    setSources(list)
  }, [])

  useEffect(() => {
    void loadSources()
    void window.api.invoke<AppInfo>('app:info').then(setInfo)
    const t = window.setInterval(() => void loadSources(), 5000)
    return () => window.clearInterval(t)
  }, [loadSources])

  // Render the clean-desktop wallpaper ahead of time so Start never waits on it.
  useEffect(() => {
    if (clean && settings.cleanDesktop.wallpaper) void exportWallpaper(settings.background).catch(() => undefined)
  }, [clean, settings.cleanDesktop.wallpaper, settings.background])

  const visible = sources.filter((s) => (mode === 'screen' ? s.kind === 'screen' : s.kind === 'window'))
  useEffect(() => {
    if (mode === 'camera') return
    if (!selected || !visible.some((s) => s.id === selected)) setSelected(visible[0]?.id ?? null)
  }, [mode, visible, selected])

  const switchMode = (m: CaptureMode): void => {
    setMode(m)
    setSelected(null)
    setStudio(m === 'window' ? settings.studioForWindow : m === 'screen' ? settings.studioForScreen : true)
  }

  const start = async (): Promise<void> => {
    setError(null)
    if (mode !== 'camera' && !selected) {
      setError('Pick a display or window on the left first.')
      return
    }
    if (mode === 'camera' && !settings.cameraEnabled) {
      setError('Turn the camera on to record camera only.')
      return
    }
    setStarting(true)
    try {
      if (clean && settings.cleanDesktop.wallpaper) await exportWallpaper(settings.background)
      await update({
        cleanDesktopEnabled: clean,
        ...(mode === 'window' ? { studioForWindow: studio } : mode === 'screen' ? { studioForScreen: studio } : {})
      })
      const src = sources.find((s) => s.id === selected)
      const opts: StartOptions = {
        mode,
        sourceId: mode === 'camera' ? null : selected,
        sourceName: src?.name,
        displayId: src?.displayId || undefined,
        camera: settings.cameraEnabled,
        mic: settings.micEnabled,
        systemAudio: settings.systemAudio && mode !== 'camera',
        studio: mode === 'camera' ? true : studio,
        cleanDesktop: clean && !!info?.cleanDesktopSupported,
        keepWindowIds: keep,
        title: title.trim() || undefined
      }
      await window.api.invoke('rec:start', opts)
      setTitle('')
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStarting(false)
    }
  }

  const windows = sources.filter((s) => s.kind === 'window')
  // Keep camera and mic open through the countdown: the recorder then reuses the warm devices.
  const live = !capturing

  return (
    <div className="page">
      <div className="crumbs">
        <span>Library</span>
        <span className="crumb-sep">/</span>
        <b>New recording</b>
      </div>
      <header className="lib-head">
        <div>
          <h1>New recording</h1>
          <p className="page-sub">Choose what to capture, check your camera and mic, then start.</p>
        </div>
      </header>

      <div className="record-layout">
        <section className="panel source-panel">
          {mode === 'camera' ? (
            <div className="camera-stage">
              <CameraPreview deviceId={settings.cameraDeviceId} enabled={settings.cameraEnabled && live} wide />
              <p className="muted small">Camera-only videos are framed on your brand background.</p>
            </div>
          ) : (
            <>
              <div className="panel-head">
                <h2>{mode === 'screen' ? 'Choose a display' : 'Choose a window'}</h2>
                <button className="chip-btn" onClick={() => void loadSources()}>
                  <Icon name="refresh" size={14} /> Refresh
                </button>
              </div>
              <div className={`source-grid ${mode === 'screen' ? 'screens' : ''}`}>
                {visible.map((s) => (
                  <button
                    key={s.id}
                    className={`source-tile ${selected === s.id ? 'selected' : ''}`}
                    onClick={() => setSelected(s.id)}
                    aria-pressed={selected === s.id}
                  >
                    <span className="source-img">
                      <Thumb src={s.thumbnail} kind={s.kind} />
                      {selected === s.id && (
                        <span className="source-check">
                          <Icon name="check" size={14} />
                        </span>
                      )}
                    </span>
                    <span className="source-label">
                      {s.appIcon ? <img className="app-icon" src={s.appIcon} alt="" /> : <Icon name={s.kind === 'screen' ? 'monitor' : 'window'} size={14} />}
                      <span className="ellipsis">{s.name}</span>
                    </span>
                  </button>
                ))}
                {!visible.length && <div className="empty-inline">No {mode === 'screen' ? 'displays' : 'windows'} found. Try Refresh.</div>}
              </div>
            </>
          )}

          {mode !== 'camera' && (
            <div className="look-block">
              <h3>Look &amp; privacy</h3>
              <Toggle icon="layers" label="Brand background" hint="Puts the capture on your brand background." checked={studio} onChange={setStudio} />
              {studio && <BackgroundPreview bg={settings.background} small />}
              {info?.cleanDesktopSupported && (
                <Toggle
                  icon="sparkle"
                  label="Clean desktop"
                  hint="Swaps the wallpaper, hides icons and minimizes other apps. Restored when you stop."
                  checked={clean}
                  onChange={setClean}
                />
              )}
              {clean && settings.cleanDesktop.minimizeWindows && windows.length > 0 && (
                <details className="disclosure">
                  <summary>
                    Keep windows visible <span className="count">{keep.length}</span>
                  </summary>
                  <div className="check-list">
                    {windows.map((w) => (
                      <label key={w.id} className="check">
                        <input
                          type="checkbox"
                          checked={keep.includes(w.id)}
                          onChange={(e) => setKeep((k) => (e.target.checked ? [...k, w.id] : k.filter((x) => x !== w.id)))}
                        />
                        <span className="ellipsis">{w.name}</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              <div className="note">
                <Icon name="shield" size={16} />
                <span>With the browser extension connected, bookmarks and toolbars are cropped out and password fields are masked.</span>
              </div>
            </div>
          )}
        </section>

        <aside className="panel rec-card">
          <h2>Record a new video</h2>

          <div className="mode-tiles">
            {MODES.map((m) => (
              <button key={m.id} className={`mode-tile ${mode === m.id ? 'selected' : ''}`} onClick={() => switchMode(m.id)} aria-pressed={mode === m.id}>
                <Icon name={m.icon} size={22} />
                <span>{m.title}</span>
              </button>
            ))}
          </div>

          <div className="title-row">
            <div className="field">
              <label className="field-label" htmlFor="rec-title">
                Title
              </label>
              <input
                id="rec-title"
                className="input pill-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Onboarding walkthrough"
                maxLength={120}
              />
              <span className="field-hint">Used as the file name. Leave empty to use the date and time.</span>
            </div>
            <div className="cam-square">
              {mode === 'camera' ? (
                <div className="camera-preview off">
                  <Icon name="camera" size={22} />
                </div>
              ) : (
                <CameraPreview deviceId={settings.cameraDeviceId} enabled={settings.cameraEnabled && live} />
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Hardware</span>
            <div className={`device-pill ${settings.cameraEnabled ? '' : 'off'}`}>
              <Icon name="camera" size={18} />
              <select value={settings.cameraDeviceId} onChange={(e) => void update({ cameraDeviceId: e.target.value })} disabled={!settings.cameraEnabled} aria-label="Camera">
                <option value="">Default camera</option>
                {devices.cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || 'Camera'}
                  </option>
                ))}
              </select>
              <Switch checked={settings.cameraEnabled} onChange={(v) => void update({ cameraEnabled: v })} label="Camera on" />
            </div>
            <div className={`device-pill ${settings.micEnabled ? '' : 'off'}`}>
              <Icon name="mic" size={18} />
              <select value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })} disabled={!settings.micEnabled} aria-label="Microphone">
                <option value="">Default microphone</option>
                {devices.mics.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || 'Microphone'}
                  </option>
                ))}
              </select>
              <Switch checked={settings.micEnabled} onChange={(v) => void update({ micEnabled: v })} label="Microphone on" />
            </div>
            {mode !== 'camera' && (
              <div className={`device-pill ${settings.systemAudio ? '' : 'off'}`}>
                <Icon name="speaker" size={18} />
                <span className="device-text">Computer sound</span>
                <Switch checked={settings.systemAudio} onChange={(v) => void update({ systemAudio: v })} label="Record computer sound" />
              </div>
            )}
          </div>

          <Waveform deviceId={settings.micDeviceId} active={settings.micEnabled && live} />

          {info && !info.ffmpeg && <div className="inline-alert warn">ffmpeg is missing, so videos will be saved as WebM.</div>}
          {error && <div className="inline-alert error">{error}</div>}

          <button className="btn btn-accent btn-pill btn-xl btn-block" disabled={busy || starting} onClick={() => void start()}>
            {starting ? 'Starting…' : 'Start recording'}
          </button>
          <p className="fine">
            {settings.resolution}p · {settings.fps} fps{settings.countdown ? ' · 3 second countdown' : ''} · stop with <kbd>Alt</kbd>
            <kbd>Shift</kbd>
            <kbd>S</kbd>
          </p>
        </aside>
      </div>
    </div>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  icon
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  icon?: string
}) {
  return (
    <label className="toggle-row">
      {icon && (
        <span className="row-icon">
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch-only" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

/** Source preview; capture thumbnails can come back empty (e.g. GPU hiccup), so fall back to an icon. */
function Thumb({ src, kind }: { src: string; kind: 'screen' | 'window' }) {
  const [broken, setBroken] = useState(false)
  const empty = !src || src.length < 40
  if (broken || empty)
    return (
      <span className="thumb-fallback">
        <Icon name={kind === 'screen' ? 'monitor' : 'window'} size={26} />
        <span>Preview unavailable</span>
      </span>
    )
  return <img src={src} alt="" onError={() => setBroken(true)} />
}

function CameraPreview({ deviceId, enabled, wide }: { deviceId: string; enabled: boolean; wide?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!enabled) return
    let stream: MediaStream | null = null
    let alive = true
    void navigator.mediaDevices
      .getUserMedia({ video: { deviceId: deviceId ? { exact: deviceId } : undefined } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        if (ref.current) ref.current.srcObject = s
      })
      .catch(() => undefined)
    return () => {
      alive = false
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [deviceId, enabled])
  if (!enabled)
    return (
      <div className={`camera-preview off ${wide ? 'wide' : ''}`}>
        <Icon name="camera" size={24} />
        <span>Camera off</span>
      </div>
    )
  return <video className={`camera-preview ${wide ? 'wide' : ''}`} ref={ref} autoPlay muted playsInline />
}

/** Scrolling mic level history, drawn as bars like a waveform. */
function Waveform({ deviceId, active }: { deviceId: string; active: boolean }) {
  const BARS = 44
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0))
  useEffect(() => {
    if (!active) {
      setLevels(Array(BARS).fill(0))
      return
    }
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let timer = 0
    let alive = true
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        ctx.createMediaStreamSource(s).connect(an)
        const buf = new Uint8Array(an.fftSize)
        timer = window.setInterval(() => {
          an.getByteTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += (v - 128) * (v - 128)
          const rms = Math.sqrt(sum / buf.length) / 128
          const lvl = Math.min(1, rms * 4.5)
          setLevels((prev) => [...prev.slice(1), lvl])
        }, 70)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId, active])
  return (
    <div className={`waveform ${active ? '' : 'idle'}`} aria-label="Microphone level" role="img">
      {levels.map((l, i) => (
        <span key={i}>
          <i style={{ height: `${Math.max(14, Math.round(l * 100))}%` }} />
        </span>
      ))}
    </div>
  )
}
