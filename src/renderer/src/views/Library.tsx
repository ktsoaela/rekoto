import { useCallback, useEffect, useMemo, useState } from 'react'
import { mediaUrl, type Settings, type VideoItem } from '@shared/types'
import { formatAgo, formatDate, formatDuration, formatMinutes, formatSize } from '../util'
import Icon from '../components/Icon'

interface Props {
  settings: Settings
  update: (p: Partial<Settings>) => Promise<Settings>
  lastSaved: string | null
  onRecord: () => void
  query: string
  onStats?: (s: { count: number; size: number }) => void
}

type Sort = 'newest' | 'oldest' | 'name' | 'size' | 'duration'
type View = 'grid' | 'list'
type Scope = 'all' | 'recent' | 'long'

const SORT_LABEL: Record<Sort, string> = {
  newest: 'Date created',
  oldest: 'Oldest first',
  name: 'Name',
  duration: 'Length',
  size: 'File size'
}

function loadPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
function savePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* storage unavailable */
  }
}

export default function Library({ settings, update, lastSaved, onRecord, query, onStats }: Props) {
  const [items, setItems] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>('all')
  const [sort, setSort] = useState<Sort>(() => loadPref('lc.sort', 'newest'))
  const [view, setView] = useState<View>(() => loadPref('lc.view', 'grid'))
  const [open, setOpen] = useState<VideoItem | null>(null)

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

  useEffect(() => {
    onStats?.({ count: items.length, size: items.reduce((s, i) => s + i.size, 0) })
  }, [items, onStats])

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const isLong = (i: VideoItem): boolean => (i.duration ?? 0) >= 300

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items.filter((i) => i.name.toLowerCase().includes(q))
    if (scope === 'recent') list = list.filter((i) => i.createdAt >= weekAgo)
    if (scope === 'long') list = list.filter(isLong)
    const by: Record<Sort, (a: VideoItem, b: VideoItem) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      duration: (a, b) => (b.duration ?? 0) - (a.duration ?? 0)
    }
    return [...list].sort(by[sort])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, sort, scope])

  const counts = {
    all: items.length,
    recent: items.filter((i) => i.createdAt >= weekAgo).length,
    long: items.filter(isLong).length
  }
  const totalSize = items.reduce((s, i) => s + i.size, 0)
  const workspace = settings.workspaceName || 'Personal workspace'

  if (open) {
    return (
      <VideoPage
        item={open}
        workspace={workspace}
        onBack={() => setOpen(null)}
        onChanged={() => void refresh()}
      />
    )
  }

  const changeFolder = async (): Promise<void> => {
    const f = await window.api.invoke<string | null>('dialog:folder')
    if (f) await update({ saveFolder: f })
  }

  return (
    <div className="page">
      <div className="crumbs">
        <span>Library</span>
        <span className="crumb-sep">/</span>
        <b>Videos</b>
      </div>

      <header className="lib-head">
        <div>
          <h1>Videos</h1>
          <div className="lib-owner">
            <span className="avatar">{workspace[0]?.toUpperCase()}</span>
            <span className="owner-name">{workspace}</span>
            <span className="owner-sep" />
            <span className="muted">
              {items.length} {items.length === 1 ? 'video' : 'videos'} · {formatSize(totalSize)}
            </span>
            <button className="chip-btn" onClick={() => void changeFolder()}>
              <Icon name="folder" size={14} /> Change folder
            </button>
          </div>
        </div>
        <button className="btn btn-accent btn-pill btn-lg" onClick={onRecord}>
          <Icon name="camera" size={18} /> Record new video
        </button>
      </header>

      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Filter videos">
          {(
            [
              ['all', 'All videos', counts.all],
              ['recent', 'This week', counts.recent],
              ['long', 'Over 5 minutes', counts.long]
            ] as Array<[Scope, string, number]>
          ).map(([id, label, count]) => (
            <button key={id} role="tab" aria-selected={scope === id} className={`tab ${scope === id ? 'active' : ''}`} onClick={() => setScope(id)}>
              {label} <span className="tab-count">{count}</span>
            </button>
          ))}
        </div>
        <div className="tabs-tools">
          <div className="view-toggle" role="group" aria-label="Layout">
            {(['list', 'grid'] as View[]).map((v) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                aria-pressed={view === v}
                aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                onClick={() => {
                  setView(v)
                  savePref('lc.view', v)
                }}
              >
                <Icon name={v} size={18} />
              </button>
            ))}
          </div>
          <label className="sort-by">
            <span className="muted">Sorting by:</span>
            <span className="sort-value">{SORT_LABEL[sort]}</span>
            <Icon name="chevron-down" size={14} />
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as Sort)
                savePref('lc.sort', e.target.value)
              }}
              aria-label="Sort videos"
            >
              {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="video-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="video-card skeleton" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name={items.length ? 'search' : 'camera'} size={26} />
          </div>
          <h3>{items.length ? 'Nothing matches' : 'No videos yet'}</h3>
          <p>
            {items.length
              ? query
                ? `No video title contains “${query}”.`
                : 'No videos in this tab yet.'
              : 'Record your screen, a window or just your camera. Each video is saved to your folder as an MP4.'}
          </p>
          {!items.length && (
            <button className="btn btn-accent btn-pill btn-lg" onClick={onRecord}>
              <Icon name="camera" size={18} /> Record your first video
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="video-grid">
          {filtered.map((v) => (
            <article
              key={v.path}
              className={`video-card ${v.path === lastSaved ? 'is-new' : ''}`}
              onClick={() => setOpen(v)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setOpen(v)}
            >
              <div className="card-top">
                <span className="avatar sm">{workspace[0]?.toUpperCase()}</span>
                <span className="ellipsis">{workspace}</span>
                <span className="card-ago">{v.path === lastSaved ? <b className="new-tag">New</b> : formatAgo(v.createdAt)}</span>
              </div>
              <div className="video-thumb">
                {v.thumb ? <img src={v.thumb} alt="" /> : <div className="thumb-empty"><Icon name="play" size={22} /></div>}
                <span className="duration-pill">{formatMinutes(v.duration)}</span>
                <span className="thumb-play"><Icon name="play" size={20} /></span>
              </div>
              <div className="card-bottom">
                <div className="card-stats">
                  <span title="Created"><Icon name="calendar" size={14} /> {new Date(v.createdAt).toLocaleDateString()}</span>
                  <span title="File size"><Icon name="file" size={14} /> {formatSize(v.size)}</span>
                </div>
                <div className="card-title" title={v.name}>{v.name}</div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="list-card">
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Created</th>
                <th className="num">Length</th>
                <th className="num">Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr key={v.path} onClick={() => setOpen(v)} className={v.path === lastSaved ? 'is-new' : ''}>
                  <td>
                    <div className="cell-name">
                      <span className="row-thumb">{v.thumb ? <img src={v.thumb} alt="" /> : <Icon name="play" size={14} />}</span>
                      <span className="ellipsis">{v.name}</span>
                    </div>
                  </td>
                  <td className="muted">{formatAgo(v.createdAt)}</td>
                  <td className="num">{formatDuration(v.duration)}</td>
                  <td className="num muted">{formatSize(v.size)}</td>
                  <td className="num">
                    <button
                      className="icon-btn sm"
                      title="Show in folder"
                      onClick={(e) => {
                        e.stopPropagation()
                        void window.api.invoke('library:reveal', v.path)
                      }}
                    >
                      <Icon name="folder" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function VideoPage({
  item,
  workspace,
  onBack,
  onChanged
}: {
  item: VideoItem
  workspace: string
  onBack: () => void
  onChanged: () => void
}) {
  const [name, setName] = useState(item.name)
  const [path, setPath] = useState(item.path)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  const rename = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === item.name) return
    try {
      const p = await window.api.invoke<string>('library:rename', path, next)
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
    onBack()
  }

  return (
    <div className="page video-page">
      <header className="vp-head">
        <div className="vp-title">
          <button className="icon-btn" onClick={onBack} aria-label="Back to videos">
            <Icon name="back" size={20} />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Video title"
          />
        </div>
        <div className="vp-actions">
          <button className="btn btn-outline btn-pill" onClick={() => void window.api.invoke('library:reveal', path)}>
            <Icon name="folder" size={16} /> Show in folder
          </button>
          {confirmDelete ? (
            <>
              <button className="btn btn-outline btn-pill" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger btn-pill" onClick={() => void remove()}>
                <Icon name="trash" size={16} /> Move to Recycle Bin
              </button>
            </>
          ) : (
            <button className="icon-btn" title="Delete" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="vp-byline">
        <span className="muted">Workspace</span>
        <span className="avatar sm">{workspace[0]?.toUpperCase()}</span>
        <b>{workspace}</b>
        <span className="muted">{formatAgo(item.createdAt)}</span>
      </div>
      {error && <div className="inline-alert error">{error}</div>}

      <div className="vp-player">
        <video src={mediaUrl(path)} controls autoPlay />
      </div>

      <div className="vp-facts">
        <div className="fact">
          <Icon name="calendar" size={18} />
          <span className="fact-label">Recorded</span>
          <b>{formatDate(item.createdAt)}</b>
        </div>
        <div className="fact">
          <Icon name="clock" size={18} />
          <span className="fact-label">Length</span>
          <b>{formatDuration(item.duration)}</b>
        </div>
        <div className="fact">
          <Icon name="file" size={18} />
          <span className="fact-label">File</span>
          <b>MP4 · {formatSize(item.size)}</b>
        </div>
        <div className="fact fact-wide" title={path}>
          <Icon name="folder" size={18} />
          <span className="fact-label">Location</span>
          <b className="ellipsis rtl">{path}</b>
        </div>
      </div>
    </div>
  )
}
