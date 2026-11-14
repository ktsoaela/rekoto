import { spawn } from 'child_process'
import fs from 'fs'
import ffmpegStatic from 'ffmpeg-static'

export function ffmpegPath(): string | null {
  const p = (ffmpegStatic as unknown as string | null)?.replace('app.asar', 'app.asar.unpacked') ?? null
  return p && fs.existsSync(p) ? p : null
}

export function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  const bin = ffmpegPath()
  if (!bin) return Promise.resolve({ code: -1, stderr: 'ffmpeg not found' })
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-hide_banner', ...args], { windowsHide: true })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000)
    })
    proc.on('error', (e) => resolve({ code: -1, stderr: String(e) }))
    proc.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** Convert a MediaRecorder WebM/MKV file to MP4. Falls back to keeping the WebM. */
export async function toMp4(input: string, output: string, isH264: boolean, fps: number): Promise<string> {
  const common = ['-y', '-fflags', '+genpts', '-i', input]
  const tail = ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output]
  if (isH264) {
    const r = await runFfmpeg([...common, '-c:v', 'copy', ...tail])
    if (r.code === 0) return output
  }
  const r = await runFfmpeg([
    ...common,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    ...tail
  ])
  if (r.code === 0) return output
  // ffmpeg unavailable or failed: keep the original recording so nothing is lost.
  const webm = output.replace(/\.mp4$/i, '.webm')
  fs.copyFileSync(input, webm)
  return webm
}

export async function probeAndThumb(input: string, thumbOut: string): Promise<{ duration: number | null; ok: boolean }> {
  let r = await runFfmpeg(['-y', '-ss', '0.5', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumbOut])
  if (r.code !== 0 || !fs.existsSync(thumbOut)) {
    r = await runFfmpeg(['-y', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', thumbOut])
  }
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr)
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
  return { duration, ok: fs.existsSync(thumbOut) }
}
