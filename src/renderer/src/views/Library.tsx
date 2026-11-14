import { useCallback, useEffect, useMemo, useState } from 'react'
import { mediaUrl, type Settings, type VideoItem } from '@shared/types'
import { formatDate, formatDuration, formatSize } from '../util'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
  lastSaved: string | null
  onRecord: () => void
}

export default function Library({ settings, update, lastSaved, onRecord }: Props) {
  const [items, setItems] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [playing, setPlaying] = useState<VideoItem | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.api.invoke<VideoItem[]>('library:list')
    setItems(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const offItem = window.api.on('library:item', (it) => {
      const item = it as VideoItem
      setItems((prev) => prev.map((p) => (p.path === item.path ? item : p)))
    })
    const offChanged = window.api.on('library:changed', () => void refresh())
    const offSaved = window.api.on('library:saved', () => void refresh())
    return () => {
      offItem()
      offChanged()
      offSaved()
    }
  }, [refresh, settings.saveFolder])

  const filtered = useMemo(
    () => items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query]
  )

  const changeFolder = async (): Promise<void> => {
    const f = await window.api.invoke<string | null>('dialog:folder')
    if (f) await update({ saveFolder: f })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <div className="muted small folder-line">
            Saving to <code>{settings.saveFolder}</code>
            <button className="link" onClick={() => void changeFolder()}>Change</button>
            <button className="link" onClick={() => void window.api.invoke('library:openFolder')}>Open folder</button>
          </div>
        </div>
        <input className="search" placeholder="Search videos" value={query} onChange={(e) => setQuery(e.target.value)} />
      </header>

      {loading ? (
        <div className="empty">Loading videos…</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p>{items.length ? 'No videos match your search.' : 'No recordings yet.'}</p>
          {!items.length && (
            <button className="primary" onClick={onRecord}>
              Record your first video
            </button>
          )}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((v) => (
            <article key={v.path} className={`card ${v.path === lastSaved ? 'fresh' : ''}`} onClick={() => setPlaying(v)}>
              <div className="thumb">
                {v.thumb ? <img src={v.thumb} alt="" /> : <div className="thumb-placeholder">▶</div>}
                <span className="duration">{formatDuration(v.duration)}</span>
              </div>
              <div className="card-body">
                <div className="card-title" title={v.name}>{v.name}</div>
                <div className="muted small">
                  {formatDate(v.createdAt)} · {formatSize(v.size)}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {playing && <Player item={playing} onClose={() => setPlaying(null)} onChanged={() => void refresh()} />}
    </div>
  )
}

function Player({ item, onClose, onChanged }: { item: VideoItem; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(item.name)
  const [path, setPath] = useState(item.path)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rename = async (): Promise<void> => {
    if (name.trim() === item.name) return
    try {
      const p = await window.api.invoke<string>('library:rename', path, name)
      setPath(p)
      setError(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const remove = async (): Promise<void> => {
    await window.api.invoke('library:delete', path)
    onChanged()
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal player" onClick={(e) => e.stopPropagation()}>
        <video src={mediaUrl(path)} controls autoPlay />
        <div className="player-bar">
          <input
            className="title-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <div className="row">
            <button onClick={() => void window.api.invoke('library:reveal', path)}>Show in folder</button>
            {confirmDelete ? (
              <>
                <button className="danger" onClick={() => void remove()}>Move to Recycle Bin</button>
                <button onClick={() => setConfirmDelete(false)}>Keep</button>
              </>
            ) : (
              <button className="danger-outline" onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        {error && <div className="banner error">{error}</div>}
      </div>
    </div>
  )
}
