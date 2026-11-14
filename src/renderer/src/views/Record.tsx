import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureMode, Settings, SourceInfo, StartOptions } from '@shared/types'
import { exportWallpaper, useDevices } from '../devices'
import BackgroundPreview from '../components/BackgroundPreview'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
  busy: boolean
}

interface AppInfo {
  cleanDesktopSupported: boolean
  ffmpeg: boolean
}

export default function Record({ settings, update, busy }: Props) {
  const [mode, setMode] = useState<CaptureMode>(settings.lastMode)
  const [sources, setSources] = useState<SourceInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [keep, setKeep] = useState<string[]>([])
  const [studio, setStudio] = useState(settings.lastMode === 'window' ? settings.studioForWindow : settings.studioForScreen)
  const [clean, setClean] = useState(settings.cleanDesktopEnabled)
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
      setError('Pick something to record first.')
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
        camera: settings.cameraEnabled,
        mic: settings.micEnabled,
        systemAudio: settings.systemAudio && mode !== 'camera',
        studio: mode === 'camera' ? true : studio,
        cleanDesktop: clean && !!info?.cleanDesktopSupported,
        keepWindowIds: keep
      }
      await window.api.invoke('rec:start', opts)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStarting(false)
    }
  }

  const windows = sources.filter((s) => s.kind === 'window')

  return (
    <div className="page record">
      <header className="page-head">
        <h1>New recording</h1>
      </header>

      <div className="record-layout">
        <section className="panel">
          <div className="segmented">
            {(['screen', 'window', 'camera'] as CaptureMode[]).map((m) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => switchMode(m)}>
                {m === 'screen' ? 'Full screen' : m === 'window' ? 'Window / app' : 'Camera only'}
              </button>
            ))}
          </div>

          {mode === 'camera' ? (
            <div className="camera-only">
              <CameraPreview deviceId={settings.cameraDeviceId} enabled={settings.cameraEnabled && !busy && !starting} />
              <p className="muted small">Your camera is recorded over the studio background.</p>
            </div>
          ) : (
            <>
              <div className="sources-head">
                <span className="muted small">{mode === 'screen' ? 'Choose a display' : 'Choose a window or app'}</span>
                <button className="link" onClick={() => void loadSources()}>Refresh</button>
              </div>
              <div className="sources">
                {visible.map((s) => (
                  <button key={s.id} className={`source ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)}>
                    <img src={s.thumbnail} alt="" />
                    <span className="source-name">
                      {s.appIcon && <img className="app-icon" src={s.appIcon} alt="" />}
                      {s.name}
                    </span>
                  </button>
                ))}
                {!visible.length && <div className="empty small">Nothing to show yet.</div>}
              </div>
            </>
          )}
        </section>

        <section className="panel options">
          <h3>Camera & audio</h3>
          <Toggle label="Camera bubble" checked={settings.cameraEnabled} onChange={(v) => void update({ cameraEnabled: v })} />
          {settings.cameraEnabled && (
            <select value={settings.cameraDeviceId} onChange={(e) => void update({ cameraDeviceId: e.target.value })}>
              <option value="">Default camera</option>
              {devices.cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>
              ))}
            </select>
          )}
          <Toggle label="Microphone" checked={settings.micEnabled} onChange={(v) => void update({ micEnabled: v })} />
          {settings.micEnabled && (
            <select value={settings.micDeviceId} onChange={(e) => void update({ micDeviceId: e.target.value })}>
              <option value="">Default microphone</option>
              {devices.mics.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label || 'Microphone'}</option>
              ))}
            </select>
          )}
          {settings.micEnabled && !busy && !starting && <MicMeter deviceId={settings.micDeviceId} />}
          {mode !== 'camera' && (
            <Toggle label="System audio (computer sound)" checked={settings.systemAudio} onChange={(v) => void update({ systemAudio: v })} />
          )}

          {mode !== 'camera' && (
            <>
              <h3>Privacy & look</h3>
              <Toggle
                label="Studio background"
                hint="Places the capture on your branded background, so the real desktop never shows."
                checked={studio}
                onChange={setStudio}
              />
              {studio && <BackgroundPreview bg={settings.background} small />}
              {info?.cleanDesktopSupported && (
                <Toggle
                  label="Clean desktop while recording"
                  hint="Swaps the wallpaper, hides icons and minimizes other apps. Everything is restored when you stop."
                  checked={clean}
                  onChange={setClean}
                />
              )}
              {clean && settings.cleanDesktop.minimizeWindows && windows.length > 0 && (
                <details className="keep">
                  <summary>Keep these windows visible ({keep.length})</summary>
                  {windows.map((w) => (
                    <label key={w.id} className="check">
                      <input
                        type="checkbox"
                        checked={keep.includes(w.id)}
                        onChange={(e) => setKeep((k) => (e.target.checked ? [...k, w.id] : k.filter((x) => x !== w.id)))}
                      />
                      <span>{w.name}</span>
                    </label>
                  ))}
                </details>
              )}
              <p className="muted small">
                Password fields and browser bookmarks are hidden through the browser extension (see Settings).
              </p>
            </>
          )}

          {info && !info.ffmpeg && <div className="banner error small">ffmpeg is missing, videos will be saved as WebM.</div>}
          {error && <div className="banner error">{error}</div>}
          <button className="primary big" disabled={busy || starting} onClick={() => void start()}>
            <span className="rec-dot" /> {starting ? 'Starting…' : 'Start recording'}
          </button>
        </section>
      </div>
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" />
    </label>
  )
}

function CameraPreview({ deviceId, enabled }: { deviceId: string; enabled: boolean }) {
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
  if (!enabled) return <div className="camera-preview off">Camera is off</div>
  return <video className="camera-preview" ref={ref} autoPlay muted playsInline />
}

function MicMeter({ deviceId }: { deviceId: string }) {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let alive = true
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((t) => t.stop())
        stream = s
        ctx = new AudioContext()
        const an = ctx.createAnalyser()
        an.fftSize = 512
        ctx.createMediaStreamSource(s).connect(an)
        const buf = new Uint8Array(an.fftSize)
        const tick = (): void => {
          an.getByteTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
          setLevel(Math.min(1, peak / 90))
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => undefined)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [deviceId])
  return (
    <div className="meter" title="Microphone level">
      <div style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  )
}
