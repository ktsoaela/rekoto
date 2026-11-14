import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listWallpaperBackups, resolveWallpaperTarget } from './wallpaper-restore.ts'

describe('resolveWallpaperTarget', () => {
  it('recovers from backup when path and source are empty (failed meta case)', () => {
    const r = resolveWallpaperTarget(
      { path: '', style: '10', tile: '0', source: '' },
      ['C:\\app\\clean-desktop\\original-wallpaper.jpg'],
      []
    )
    assert.equal(r?.path, 'C:\\app\\clean-desktop\\original-wallpaper.jpg')
  })

  it('recovers from Windows history when a remembered path is gone', () => {
    const r = resolveWallpaperTarget(
      { path: 'C:\\gone\\old.jpg', style: '6', tile: '0', source: 'C:\\gone\\old.jpg' },
      [],
      ['C:\\Users\\me\\Pictures\\IMG_1033.jpg', 'C:\\app\\studio-wallpaper.png'],
      () => false
    )
    assert.equal(r?.path, 'C:\\Users\\me\\Pictures\\IMG_1033.jpg')
    assert.equal(r?.style, '6')
  })

  it('does not use Windows history for an empty solid-colour desktop', () => {
    const r = resolveWallpaperTarget(
      { path: '', style: '10', tile: '0', source: '' },
      [],
      ['C:\\Users\\me\\Pictures\\old.jpg']
    )
    assert.deepEqual(r, { path: '', style: '10', tile: '0', source: '' })
  })

  it('prefers the live source file over the backup copy', () => {
    const r = resolveWallpaperTarget(
      {
        path: 'C:\\app\\clean-desktop\\original-wallpaper.jpg',
        style: '10',
        tile: '0',
        source: 'C:\\Users\\me\\Pictures\\real.jpg'
      },
      ['C:\\app\\clean-desktop\\original-wallpaper.jpg'],
      []
    )
    assert.equal(r?.path, 'C:\\Users\\me\\Pictures\\real.jpg')
  })

  it('does not restore studio-wallpaper as the user wallpaper', () => {
    const r = resolveWallpaperTarget(
      { path: 'C:\\app\\studio-wallpaper.png', style: '10', tile: '0', source: 'C:\\app\\studio-wallpaper.png' },
      [],
      ['C:\\app\\studio-wallpaper.png', 'C:\\Users\\me\\Pictures\\ok.jpg']
    )
    assert.equal(r?.path, 'C:\\Users\\me\\Pictures\\ok.jpg')
  })

  it('skips restore instead of clearing when only a missing path remains', () => {
    const r = resolveWallpaperTarget(
      { path: 'C:\\missing\\gone.jpg', style: '10', tile: '0' },
      [],
      [],
      () => false
    )
    assert.equal(r, null)
  })

  it('keeps solid colour when there was never an image', () => {
    const r = resolveWallpaperTarget({ path: '', style: '10', tile: '0', source: '' }, [], [])
    assert.deepEqual(r, { path: '', style: '10', tile: '0', source: '' })
  })
})

describe('listWallpaperBackups', () => {
  it('keeps image backups and drops the json meta', () => {
    const names = ['original-wallpaper.jpg', 'original-wallpaper.json', 'desk.ps1']
    assert.deepEqual(listWallpaperBackups(names, 'D:\\cd', (a, b) => `${a}\\${b}`), [
      'D:\\cd\\original-wallpaper.jpg'
    ])
  })
})
