import { useEffect, useState } from 'react'
import type { BackgroundConfig, ExtensionInfo, LogoPosition, Settings } from '@shared/types'
import BackgroundPreview from '../components/BackgroundPreview'
import { Toggle } from './Record'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
}

const PRESETS: Array<Pick<BackgroundConfig, 'kind' | 'color1' | 'color2' | 'angle'>> = [
  { kind: 'gradient', color1: '#4f46e5', color2: '#0ea5e9', angle: 135 },
  { kind: 'gradient', color1: '#f97316', color2: '#db2777', angle: 135 },
  { kind: 'gradient', color1: '#10b981', color2: '#0f766e', angle: 160 },
  { kind: 'gradient', color1: '#1f2937', color2: '#111827', angle: 180 },
  { kind: 'solid', color1: '#f3f4f6', color2: '#f3f4f6', angle: 0 },
  { kind: 'solid', color1: '#0b1220', color2: '#0b1220', angle: 0 }
]

export default function SettingsView({ settings, update }: Props) {
  const bg = settings.background
  const setBg = (patch: Partial<BackgroundConfig>): void => void update({ background: { ...bg, ...patch } })
  const pickImage = async (): Promise<string | null> => window.api.invoke<string | null>('dialog:image')

  return (
    <div className="page settings">
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <section className="panel">
        <h3>Where videos are saved</h3>
        <div className="row">
          <code className="path">{settings.saveFolder}</code>
          <button
            onClick={async () => {
              const f = await window.api.invoke<string | null>('dialog:folder')
              if (f) await update({ saveFolder: f })
            }}
          >
            Change folder
          </button>
          <button onClick={() => void window.api.invoke('library:openFolder')}>Open</button>
        </div>
        <p className="muted small">The library shows every video in this folder. Recordings are saved as MP4 (H.264).</p>
      </section>

      <section className="panel">
        <h3>Recording</h3>
        <div className="row">
          <label className="field">
            <span>Resolution</span>
            <select value={settings.resolution} onChange={(e) => void update({ resolution: Number(e.target.value) as Settings['resolution'] })}>
              <option value={720}>720p</option>
              <option value={1080}>1080p</option>
              <option value={1440}>1440p</option>
            </select>
          </label>
          <label className="field">
            <span>Frame rate</span>
            <select value={settings.fps} onChange={(e) => void update({ fps: Number(e.target.value) as Settings['fps'] })}>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
        </div>
        <Toggle label="3-second countdown" checked={settings.countdown} onChange={(v) => void update({ countdown: v })} />
      </section>

      <section className="panel">
        <h3>Studio background</h3>
        <p className="muted small">
          Drawn behind the captured window inside the video, and used as your wallpaper in clean-desktop mode. Use a company logo or branded image.
        </p>
        <div className="bg-editor">
          <BackgroundPreview bg={bg} />
          <div className="bg-controls">
            <div className="presets">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  className="preset"
                  style={{ background: p.kind === 'solid' ? p.color1 : `linear-gradient(${p.angle}deg, ${p.color1}, ${p.color2})` }}
                  onClick={() => setBg(p)}
                />
              ))}
            </div>
            <label className="field">
              <span>Type</span>
              <select value={bg.kind} onChange={(e) => setBg({ kind: e.target.value as BackgroundConfig['kind'] })}>
                <option value="gradient">Gradient</option>
                <option value="solid">Solid color</option>
                <option value="image">Image</option>
              </select>
            </label>
            {bg.kind !== 'image' ? (
              <div className="row">
                <label className="field color">
                  <span>{bg.kind === 'gradient' ? 'From' : 'Color'}</span>
                  <input type="color" value={bg.color1} onChange={(e) => setBg({ color1: e.target.value })} />
                </label>
                {bg.kind === 'gradient' && (
                  <>
                    <label className="field color">
                      <span>To</span>
                      <input type="color" value={bg.color2} onChange={(e) => setBg({ color2: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Angle {bg.angle}°</span>
                      <input type="range" min={0} max={360} value={bg.angle} onChange={(e) => setBg({ angle: Number(e.target.value) })} />
                    </label>
                  </>
                )}
              </div>
            ) : (
              <div className="row">
                <button
                  onClick={async () => {
                    const p = await pickImage()
                    if (p) setBg({ imagePath: p })
                  }}
                >
                  {bg.imagePath ? 'Change image' : 'Choose image'}
                </button>
                {bg.imagePath && <span className="muted small ellipsis">{bg.imagePath}</span>}
              </div>
            )}
            <div className="row">
              <button
                onClick={async () => {
                  const p = await pickImage()
                  if (p) setBg({ logoPath: p })
                }}
              >
                {bg.logoPath ? 'Change logo' : 'Add logo'}
              </button>
              {bg.logoPath && <button className="link" onClick={() => setBg({ logoPath: null })}>Remove logo</button>}
            </div>
            {bg.logoPath && (
              <div className="row">
                <label className="field">
                  <span>Logo position</span>
                  <select value={bg.logoPosition} onChange={(e) => setBg({ logoPosition: e.target.value as LogoPosition })}>
                    <option value="top-left">Top left</option>
                    <option value="top-right">Top right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-right">Bottom right</option>
                    <option value="center">Center</option>
                  </select>
                </label>
                <label className="field">
                  <span>Logo size</span>
                  <input type="range" min={0.04} max={0.4} step={0.01} value={bg.logoScale} onChange={(e) => setBg({ logoScale: Number(e.target.value) })} />
                </label>
              </div>
            )}
            <div className="row">
              <label className="field grow">
                <span>Caption (optional)</span>
                <input type="text" value={bg.text} placeholder="Company name or tagline" onChange={(e) => setBg({ text: e.target.value })} />
              </label>
              <label className="field color">
                <span>Text</span>
                <input type="color" value={bg.textColor} onChange={(e) => setBg({ textColor: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label className="field">
                <span>Padding</span>
                <input type="range" min={0} max={0.15} step={0.01} value={settings.studioPadding} onChange={(e) => void update({ studioPadding: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>Corner radius</span>
                <input type="range" min={0} max={40} value={settings.cornerRadius} onChange={(e) => void update({ cornerRadius: Number(e.target.value) })} />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Clean desktop</h3>
        <p className="muted small">Applied during full-screen recordings when turned on. Your original wallpaper, icons and windows come back when you stop, even after a crash.</p>
        <Toggle label="Use clean desktop by default" checked={settings.cleanDesktopEnabled} onChange={(v) => void update({ cleanDesktopEnabled: v })} />
        {(
          [
            ['wallpaper', 'Swap wallpaper for the studio background'],
            ['hideIcons', 'Hide desktop icons'],
            ['minimizeWindows', 'Minimize other apps'],
            ['hideTaskbar', 'Hide the taskbar']
          ] as const
        ).map(([k, label]) => (
          <Toggle key={k} label={label} checked={settings.cleanDesktop[k]} onChange={(v) => void update({ cleanDesktop: { ...settings.cleanDesktop, [k]: v } })} />
        ))}
      </section>

      <section className="panel">
        <h3>Browser privacy</h3>
        <Toggle
          label="Mask password fields while recording"
          hint="Typed passwords, one-time codes and card numbers are blanked out in Chrome, Edge and Firefox."
          checked={settings.maskPasswords}
          onChange={(v) => void update({ maskPasswords: v })}
        />
        <Toggle
          label="Crop out bookmarks, tabs and address bar"
          hint="When recording a browser window, only the web page is kept in the video."
          checked={settings.cropBrowserChrome}
          onChange={(v) => void update({ cropBrowserChrome: v })}
        />
        <ExtensionSetup />
      </section>
    </div>
  )
}

function ExtensionSetup() {
  const [info, setInfo] = useState<ExtensionInfo | null>(null)
  const load = (): void => void window.api.invoke<ExtensionInfo>('ext:info').then(setInfo)
  useEffect(() => {
    load()
    const off = window.api.on('ext:changed', load)
    const t = window.setInterval(load, 4000)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [])
  if (!info) return null
  return (
    <div className="ext-setup">
      <div className="row">
        <span className={`status-dot ${info.hostRegistered ? 'ok' : 'bad'}`} />
        <span>{info.hostRegistered ? 'Browser connection installed' : `Browser connection not installed${info.hostError ? `: ${info.hostError}` : ''}`}</span>
        <button className="link" onClick={() => void window.api.invoke('ext:register').then(load)}>Reinstall</button>
      </div>
      <div className="row">
        <span className="muted small">Connected now: {info.connected.length ? info.connected.join(', ') : 'none'}</span>
      </div>
      <div className="ext-cards">
        <div className="ext-card">
          <strong>Chrome / Edge</strong>
          <ol className="small">
            <li>Open <code>chrome://extensions</code> (or <code>edge://extensions</code>).</li>
            <li>Turn on Developer mode.</li>
            <li>Click Load unpacked and pick the folder below.</li>
          </ol>
          <button onClick={() => void window.api.invoke('shell:openPath', info.chromeFolder)}>Open extension folder</button>
          <div className="muted small ellipsis">{info.chromeFolder}</div>
        </div>
        <div className="ext-card">
          <strong>Firefox</strong>
          <ol className="small">
            <li>Open <code>about:debugging#/runtime/this-firefox</code>.</li>
            <li>Click Load Temporary Add-on.</li>
            <li>Pick <code>manifest.json</code> in the folder below.</li>
          </ol>
          <button onClick={() => void window.api.invoke('shell:openPath', info.firefoxFolder)}>Open extension folder</button>
          <div className="muted small ellipsis">{info.firefoxFolder}</div>
        </div>
      </div>
    </div>
  )
}
