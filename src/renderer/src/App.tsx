import { useCallback, useEffect, useState } from 'react'
import type { RecState, Settings } from '@shared/types'
import Library from './views/Library'
import Record from './views/Record'
import SettingsView from './views/Settings'

type Tab = 'library' | 'record' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rec, setRec] = useState<RecState | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

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

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.invoke<Settings>('settings:set', patch)
    setSettings(next)
    return next
  }, [])

  if (!settings) return <div className="loading">Loading…</div>

  const banner =
    rec?.status === 'processing'
      ? { kind: 'info', text: 'Saving your recording…' }
      : rec?.error && rec.error !== dismissed
        ? { kind: 'error', text: rec.error }
        : null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" /> Loom Clone
        </div>
        <button className="new-rec" onClick={() => setTab('record')}>
          <span className="rec-dot" /> New recording
        </button>
        <nav>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
            Library
          </button>
          <button className={tab === 'record' ? 'active' : ''} onClick={() => setTab('record')}>
            Record
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            Settings
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">Shortcuts while recording</div>
          <div className="small">Alt+Shift+S stop · Alt+Shift+P pause · Alt+Shift+C discard</div>
        </div>
      </aside>
      <main className="content">
        {banner && (
          <div className={`banner ${banner.kind}`}>
            <span>{banner.text}</span>
            {banner.kind === 'error' && <button onClick={() => setDismissed(rec!.error)}>Dismiss</button>}
          </div>
        )}
        {tab === 'library' && <Library settings={settings} update={update} lastSaved={rec?.lastSaved ?? null} onRecord={() => setTab('record')} />}
        {tab === 'record' && <Record settings={settings} update={update} busy={!!rec && rec.status !== 'idle'} />}
        {tab === 'settings' && <SettingsView settings={settings} update={update} />}
      </main>
    </div>
  )
}
