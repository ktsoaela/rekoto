import { useEffect, useState, type ReactNode } from 'react'
import type { BackgroundConfig, ExtensionInfo, LogoPosition, Settings } from '@shared/types'
import BackgroundPreview from '../components/BackgroundPreview'
import Icon from '../components/Icon'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
}

const PRESETS: Array<{ name: string } & Pick<BackgroundConfig, 'kind' | 'color1' | 'color2' | 'angle'>> = [
  { name: 'Black & gold', kind: 'gradient', color1: '#0d0d0d', color2: '#3a2f00', angle: 135 },
  { name: 'Yellow', kind: 'gradient', color1: '#ffc400', color2: '#ffdf6b', angle: 135 },
  { name: 'Onyx', kind: 'solid', color1: '#141414', color2: '#141414', angle: 0 },
  { name: 'Navy', kind: 'gradient', color1: '#0b1f3a', color2: '#1d4ed8', angle: 135 },
  { name: 'Slate', kind: 'gradient', color1: '#1e293b', color2: '#475569', angle: 160 },
  { name: 'Ocean', kind: 'gradient', color1: '#0f766e', color2: '#0369a1', angle: 135 },
  { name: 'Graphite', kind: 'solid', color1: '#111827', color2: '#111827', angle: 0 },
  { name: 'Paper', kind: 'solid', color1: '#f1f5f9', color2: '#f1f5f9', angle: 0 },
  { name: 'Indigo', kind: 'gradient', color1: '#312e81', color2: '#6366f1', angle: 135 }
]

const SECTIONS = [
  { id: 'workspace', label: 'Workspace', icon: 'layers' },
  { id: 'storage', label: 'Storage', icon: 'folder' },
  { id: 'recording', label: 'Recording', icon: 'record' },
  { id: 'brand', label: 'Brand background', icon: 'image' },
  { id: 'desktop', label: 'Clean desktop', icon: 'sparkle' },
  { id: 'privacy', label: 'Browser privacy', icon: 'shield' }
]

export default function SettingsView({ settings, update }: Props) {
  const bg = settings.background
  const setBg = (patch: Partial<BackgroundConfig>): void => void update({ background: { ...bg, ...patch } })
  const pickImage = async (): Promise<string | null> => window.api.invoke<string | null>('dialog:image')
  const [name, setName] = useState(settings.workspaceName)
  const [caption, setCaption] = useState(bg.text)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Changes are saved automatically.</p>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#s-${s.id}`} onClick={(e) => {
              e.preventDefault()
              document.getElementById(`s-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}>
              <Icon name={s.icon} size={16} /> {s.label}
            </a>
          ))}
        </nav>

        <div className="settings-body">
          <Section id="workspace" title="Workspace" desc="How your organization appears in the app and in videos.">
            <Row label="Workspace name" desc="Shown in the sidebar.">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void update({ workspaceName: name.trim() })} placeholder="Company or team name" />
            </Row>
            <Row label="Company logo" desc="Used in the sidebar and on the brand background.">
              <div className="row-actions">
                <button className="btn btn-secondary" onClick={async () => {
                  const p = await pickImage()
                  if (p) setBg({ logoPath: p })
                }}>
                  <Icon name="image" /> {bg.logoPath ? 'Replace logo' : 'Upload logo'}
                </button>
                {bg.logoPath && <button className="btn btn-ghost" onClick={() => setBg({ logoPath: null })}>Remove</button>}
              </div>
            </Row>
          </Section>

          <Section id="storage" title="Storage" desc="Recordings are stored only on this computer.">
            <Row label="Save folder" desc="The library lists every video in this folder.">
              <div className="path-field">
                <code title={settings.saveFolder}>{settings.saveFolder}</code>
                <button className="btn btn-secondary" onClick={async () => {
                  const f = await window.api.invoke<string | null>('dialog:folder')
                  if (f) await update({ saveFolder: f })
                }}>Change…</button>
                <button className="btn-icon" title="Open in Explorer" onClick={() => void window.api.invoke('library:openFolder')}>
                  <Icon name="external" size={16} />
                </button>
              </div>
            </Row>
            <Row label="File format" desc="H.264 video with AAC audio. It plays in every common player.">
              <span className="pill">MP4</span>
            </Row>
          </Section>

          <Section id="recording" title="Recording" desc="Quality and start behavior.">
            <Row label="Resolution" desc="Output video height.">
              <select className="input" value={settings.resolution} onChange={(e) => void update({ resolution: Number(e.target.value) as Settings['resolution'] })}>
                <option value={720}>720p (HD)</option>
                <option value={1080}>1080p (Full HD)</option>
                <option value={1440}>1440p (QHD)</option>
              </select>
            </Row>
            <Row label="Frame rate" desc="Use 60 fps for fast motion or demos.">
              <select className="input" value={settings.fps} onChange={(e) => void update({ fps: Number(e.target.value) as Settings['fps'] })}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </Row>
            <Row label="Countdown" desc="Wait 3 seconds before recording starts.">
              <Switch checked={settings.countdown} onChange={(v) => void update({ countdown: v })} />
            </Row>
          </Section>

          <Section id="brand" title="Brand background" desc="Shown behind captured windows in your videos, and used as your wallpaper in clean-desktop mode.">
            <div className="brand-editor">
              <div className="brand-preview">
                <BackgroundPreview bg={bg} />
                <span className="caption">Preview</span>
              </div>
              <div className="brand-controls">
                <div className="field">
                  <span className="field-label">Presets</span>
                  <div className="swatches">
                    {PRESETS.map((p) => (
                      <button
                        key={p.name}
                        className="swatch"
                        title={p.name}
                        aria-label={p.name}
                        style={{ background: p.kind === 'solid' ? p.color1 : `linear-gradient(${p.angle}deg, ${p.color1}, ${p.color2})` }}
                        onClick={() => setBg({ kind: p.kind, color1: p.color1, color2: p.color2, angle: p.angle })}
                      />
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">Style</span>
                  <div className="seg seg-text">
                    {(['gradient', 'solid', 'image'] as const).map((k) => (
                      <button key={k} className={bg.kind === k ? 'active' : ''} onClick={() => setBg({ kind: k })}>
                        {k === 'gradient' ? 'Gradient' : k === 'solid' ? 'Solid' : 'Image'}
                      </button>
                    ))}
                  </div>
                </div>
                {bg.kind !== 'image' ? (
                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">{bg.kind === 'gradient' ? 'Start color' : 'Color'}</span>
                      <ColorInput value={bg.color1} onChange={(v) => setBg({ color1: v })} />
                    </label>
                    {bg.kind === 'gradient' && (
                      <>
                        <label className="field">
                          <span className="field-label">End color</span>
                          <ColorInput value={bg.color2} onChange={(v) => setBg({ color2: v })} />
                        </label>
                        <label className="field grow">
                          <span className="field-label">Angle <b>{bg.angle}°</b></span>
                          <input type="range" min={0} max={360} value={bg.angle} onChange={(e) => setBg({ angle: Number(e.target.value) })} />
                        </label>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="field">
                    <span className="field-label">Background image</span>
                    <div className="row-actions">
                      <button className="btn btn-secondary" onClick={async () => {
                        const p = await pickImage()
                        if (p) setBg({ imagePath: p })
                      }}>
                        <Icon name="image" /> {bg.imagePath ? 'Replace image' : 'Choose image'}
                      </button>
                      {bg.imagePath && <span className="muted small ellipsis">{bg.imagePath.split(/[\\/]/).pop()}</span>}
                    </div>
                  </div>
                )}
                {bg.logoPath && (
                  <div className="field-row">
                    <label className="field">
                      <span className="field-label">Logo position</span>
                      <select className="input" value={bg.logoPosition} onChange={(e) => setBg({ logoPosition: e.target.value as LogoPosition })}>
                        <option value="top-left">Top left</option>
                        <option value="top-right">Top right</option>
                        <option value="bottom-left">Bottom left</option>
                        <option value="bottom-right">Bottom right</option>
                        <option value="center">Center</option>
                      </select>
                    </label>
                    <label className="field grow">
                      <span className="field-label">Logo size</span>
                      <input type="range" min={0.04} max={0.4} step={0.01} value={bg.logoScale} onChange={(e) => setBg({ logoScale: Number(e.target.value) })} />
                    </label>
                  </div>
                )}
                <div className="field-row">
                  <label className="field grow">
                    <span className="field-label">Caption</span>
                    <input className="input" value={caption} placeholder="e.g. Acme Inc. · Product Team" onChange={(e) => setCaption(e.target.value)} onBlur={() => setBg({ text: caption })} />
                  </label>
                  <label className="field">
                    <span className="field-label">Caption color</span>
                    <ColorInput value={bg.textColor} onChange={(v) => setBg({ textColor: v })} />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field grow">
                    <span className="field-label">Frame padding</span>
                    <input type="range" min={0} max={0.15} step={0.01} value={settings.studioPadding} onChange={(e) => void update({ studioPadding: Number(e.target.value) })} />
                  </label>
                  <label className="field grow">
                    <span className="field-label">Corner radius</span>
                    <input type="range" min={0} max={40} value={settings.cornerRadius} onChange={(e) => void update({ cornerRadius: Number(e.target.value) })} />
                  </label>
                </div>
              </div>
            </div>
          </Section>

          <Section id="desktop" title="Clean desktop" desc="For full-screen recordings. Everything is restored when you stop, and also after a crash.">
            <Row label="Enable by default" desc="Turns on clean desktop for each new recording.">
              <Switch checked={settings.cleanDesktopEnabled} onChange={(v) => void update({ cleanDesktopEnabled: v })} />
            </Row>
            {(
              [
                ['wallpaper', 'Replace wallpaper', 'Only during recording: show your brand background as the wallpaper, then restore yours.'],
                ['hideIcons', 'Hide desktop icons', 'Hide files and shortcuts on the desktop.'],
                ['minimizeWindows', 'Minimize other apps', 'Minimize apps you are not presenting.'],
                ['hideTaskbar', 'Hide taskbar', 'Hide pinned and running apps.']
              ] as const
            ).map(([k, label, desc]) => (
              <Row key={k} label={label} desc={desc}>
                <Switch checked={settings.cleanDesktop[k]} onChange={(v) => void update({ cleanDesktop: { ...settings.cleanDesktop, [k]: v } })} />
              </Row>
            ))}
          </Section>

          <Section
            id="privacy"
            title="Browser privacy"
            desc="Needs the Rekoto extension connected. Masks page password fields and crops tabs, address bar, and bookmarks. Chrome’s own password popups are browser UI — they are not masked; minimize them or use clean desktop."
          >
            <Row label="Mask sensitive fields" desc="Hide passwords, one-time codes and card numbers in the page while recording.">
              <Switch checked={settings.maskPasswords} onChange={(v) => void update({ maskPasswords: v })} />
            </Row>
            <Row label="Hide browser toolbars" desc="Crop tabs, the address bar and the bookmarks bar so only the page is in the video.">
              <Switch checked={settings.cropBrowserChrome} onChange={(v) => void update({ cropBrowserChrome: v })} />
            </Row>
            <ExtensionSetup />
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section id={`s-${id}`} className="card settings-section">
      <header className="section-head">
        <h2>{title}</h2>
        <p>{desc}</p>
      </header>
      <div className="section-rows">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {desc && <span className="setting-desc">{desc}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-only">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="color-input">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <code>{value.toUpperCase()}</code>
    </span>
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
  const connected = (b: string): boolean => info.connected.includes(b)
  return (
    <div className="ext-panel">
      <div className="ext-status">
        <span className={`status ${info.hostRegistered ? 'ok' : 'bad'}`}>
          <Icon name={info.hostRegistered ? 'check' : 'alert'} size={14} />
          {info.hostRegistered ? 'Browser connection installed' : 'Browser connection not installed'}
        </span>
        {info.hostError && <span className="muted small">{info.hostError}</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => void window.api.invoke('ext:register').then(load)}>
          <Icon name="refresh" size={14} /> Reinstall
        </button>
      </div>
      <div className="ext-grid">
        <ExtCard
          title="Chrome & Edge"
          icon="chrome"
          live={connected('chrome') || connected('edge')}
          steps={
            connected('chrome') || connected('edge')
              ? [<>Extension is linked to Rekoto. Keep the desktop app open while you record.</>]
              : [
                  <>Open <code>chrome://extensions</code> or <code>edge://extensions</code></>,
                  <>Turn on <b>Developer mode</b></>,
                  <>Click <b>Load unpacked</b> (or <b>Reload</b> if it is already installed) and select the folder</>,
                  <>Click the Rekoto toolbar icon once — the popup must say <b>Connected to Rekoto</b></>
                ]
          }
          folder={info.chromeFolder}
        />
        <ExtCard
          title="Firefox"
          icon="globe"
          live={connected('firefox')}
          steps={[
            <>Open <code>about:debugging#/runtime/this-firefox</code></>,
            <>Click <b>Load Temporary Add-on</b></>,
            <>Select <code>manifest.json</code> in the folder</>
          ]}
          folder={info.firefoxFolder}
        />
      </div>
    </div>
  )
}

function ExtCard({ title, icon, live, steps, folder }: { title: string; icon: string; live: boolean; steps: ReactNode[]; folder: string }) {
  return (
    <div className="ext-card">
      <div className="ext-card-head">
        <Icon name={icon} />
        <strong>{title}</strong>
        <span className={`chip ${live ? 'chip-ok' : ''}`}>{live ? 'Connected' : 'Not connected'}</span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <button className="btn btn-secondary btn-sm" onClick={() => void window.api.invoke('shell:openPath', folder)}>
        <Icon name="folder" size={14} /> Open extension folder
      </button>
    </div>
  )
}
