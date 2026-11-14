import { useCallback, useEffect, useState } from 'react'
import { mediaUrl, type DiskInfo, type RecState, type Settings } from '@shared/types'
import Library from './views/Library'
import Record from './views/Record'
import SettingsView from './views/Settings'
import Icon from './components/Icon'
import { formatSize } from './util'

type Tab = 'library' | 'record' | 'settings'
type Theme = 'light' | 'dark' | 'system'

const NAV: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'record', label: 'Record', icon: 'record' }
]

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('rk.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    localStorage.setItem('rk.theme', t)
  } catch {
    /* storage unavailable */
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rec, setRec] = useState<RecState | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [libraryStats, setLibraryStats] = useState({ count: 0, size: 0 })

  useEffect(() => applyTheme(theme), [theme])

  useEffect(() => {
    void window.api.invoke<Settings>('settings:get').then(setSettings)
    void window.api.invoke<RecState>('rec:state').then(setRec)
    const off = window.api.on('rec:state', (s) => setRec(s as RecState))
    const offSaved = window.api.on('library:saved', () => setTab('library'))
    return () => {
      off()
      offSaved()
    }
  }, [])

  useEffect(() => {
    window.api
      .invoke<DiskInfo | null>('library:disk')
      .then(setDisk)
      .catch(() => setDisk(null))
  }, [settings?.saveFolder, libraryStats.size])

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.invoke<Settings>('settings:set', patch)
    setSettings(next)
    return next
  }, [])

  if (!settings) return <div className="boot">Loading Rekoto…</div>

  const processing = rec?.status === 'processing'
  const busy = !!rec && rec.status !== 'idle'
  const error = rec?.error && rec.error !== dismissed ? rec.error : null
  const logo = settings.background.logoPath
  const workspace = settings.workspaceName || 'Personal workspace'
  const used = disk ? disk.total - disk.free : 0
  const usedPct = disk && disk.total ? Math.min(100, Math.round((used / disk.total) * 100)) : 0

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden>
            R<i />
          </span>
          <span className="brand-name">Rekoto</span>
        </div>

        <label className="top-search">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (tab !== 'library') setTab('library')
            }}
            placeholder="Search videos by title"
            aria-label="Search videos"
          />
          <Icon name="search" size={18} />
        </label>

        <div className="topbar-actions">
          <div className="theme-switch" role="group" aria-label="Theme">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                className={theme === t ? 'active' : ''}
                onClick={() => setTheme(t)}
                title={t === 'system' ? 'Match Windows' : t === 'light' ? 'Light' : 'Dark'}
                aria-pressed={theme === t}
              >
                <Icon name={t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor'} size={15} />
              </button>
            ))}
          </div>
          <button className="icon-btn" title="Open save folder" onClick={() => void window.api.invoke('library:openFolder')}>
            <Icon name="folder" />
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setTab('settings')}>
            <Icon name="settings" />
          </button>
          <button className="btn btn-dark btn-pill" onClick={() => setTab('record')} disabled={busy}>
            <span className="rec-dot" /> {busy ? (processing ? 'Saving…' : 'Recording…') : 'New recording'}
          </button>
        </div>
      </header>

      <div className="frame">
        <aside className="sidebar">
          <nav className="nav" aria-label="Primary">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${tab === n.id ? 'active' : ''}`}
                onClick={() => setTab(n.id)}
                aria-current={tab === n.id ? 'page' : undefined}
              >
                <Icon name={n.icon} size={20} />
                {n.label}
              </button>
            ))}
          </nav>
          <div className="nav-sep" />
          <nav className="nav" aria-label="Secondary">
            <button
              className={`nav-item ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => setTab('settings')}
              aria-current={tab === 'settings' ? 'page' : undefined}
            >
              <Icon name="settings" size={20} /> Settings
            </button>
            <button className="nav-item" onClick={() => void window.api.invoke('library:openFolder')}>
              <Icon name="folder" size={20} /> Save folder
            </button>
          </nav>

          <div className="sidebar-foot">
            <button className="workspace-pill" onClick={() => setTab('settings')} title="Workspace settings">
              {logo ? <img src={mediaUrl(logo)} alt="" /> : <span className="ws-initial">{workspace[0]?.toUpperCase()}</span>}
              <span className="ellipsis">{workspace}</span>
              <Icon name="chevrons" size={16} />
            </button>
          </div>

          <div className="storage-card">
            <strong>Local storage</strong>
            <p>Videos never leave this PC. They are saved to your chosen folder as MP4.</p>
            <div className="storage-figures">
              <span>
                <b>{libraryStats.count}</b> {libraryStats.count === 1 ? 'video' : 'videos'}
              </span>
              <span className="muted">{formatSize(libraryStats.size)}</span>
            </div>
            <div className="meter-line" aria-label={`Disk ${usedPct}% used`}>
              <span style={{ width: `${usedPct}%` }} />
            </div>
            <span className="storage-free">{disk ? `${formatSize(disk.free)} free on this drive` : 'Checking drive…'}</span>
            <button className="btn btn-dark btn-pill btn-block" onClick={() => void window.api.invoke('library:openFolder')}>
              Open folder
            </button>
          </div>
        </aside>

        <main className="content">
          {(processing || error) && (
            <div className={`toast ${error ? 'toast-error' : 'toast-info'}`} role="status">
              <Icon name={error ? 'alert' : 'clock'} />
              <span>{error ?? 'Saving your recording…'}</span>
              {error && (
                <button className="icon-btn sm" onClick={() => setDismissed(rec!.error)} aria-label="Dismiss">
                  <Icon name="x" size={16} />
                </button>
              )}
            </div>
          )}

          {tab === 'library' && (
            <Library
              settings={settings}
              update={update}
              lastSaved={rec?.lastSaved ?? null}
              onRecord={() => setTab('record')}
              query={query}
              onStats={setLibraryStats}
            />
          )}
          {tab === 'record' && (
            <Record
              settings={settings}
              update={update}
              busy={busy}
              capturing={rec?.status === 'recording' || rec?.status === 'paused' || rec?.status === 'processing'}
            />
          )}
          {tab === 'settings' && <SettingsView settings={settings} update={update} />}
        </main>
      </div>
    </div>
  )
}
