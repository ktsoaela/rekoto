/**
 * Frame plumbing that works in a hidden (never painted) window.
 * <video> elements and canvas.captureStream() only advance when the page renders, so we read
 * source frames with MediaStreamTrackProcessor, which delivers frames regardless of painting.
 */

/* Chromium-only APIs, not yet in lib.dom.d.ts */
declare global {
  // eslint-disable-next-line no-var
  var MediaStreamTrackProcessor: { new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> } }
}

export class FrameSource {
  frame: VideoFrame | null = null
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private stopped = false

  constructor(private track: MediaStreamTrack) {}

  get width(): number {
    return this.frame?.displayWidth ?? 0
  }
  get height(): number {
    return this.frame?.displayHeight ?? 0
  }

  /** Starts reading and resolves once the first frame arrived. */
  async start(timeoutMs = 10_000): Promise<void> {
    const proc = new MediaStreamTrackProcessor({ track: this.track })
    this.reader = proc.readable.getReader()
    let first!: () => void
    const gotFirst = new Promise<void>((r) => (first = r))
    void (async () => {
      while (!this.stopped) {
        const { value, done } = await this.reader!.read()
        if (done || !value) break
        this.frame?.close()
        this.frame = value
        first()
      }
    })().catch(() => undefined)
    await Promise.race([gotFirst, new Promise<void>((_, rej) => setTimeout(() => rej(new Error('No video frames from capture source')), timeoutMs))])
  }

  stop(): void {
    this.stopped = true
    void this.reader?.cancel().catch(() => undefined)
    this.frame?.close()
    this.frame = null
  }
}
