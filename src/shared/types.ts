export type CaptureMode = 'screen' | 'window' | 'camera'

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

export interface BackgroundConfig {
  kind: 'gradient' | 'solid' | 'image'
  color1: string
  color2: string
  angle: number
  imagePath: string | null
  logoPath: string | null
  logoPosition: LogoPosition
  /** Logo width as a fraction of the canvas width. */
  logoScale: number
  text: string
  textColor: string
}

export interface CleanDesktopConfig {
  wallpaper: boolean
  hideIcons: boolean
  minimizeWindows: boolean
  hideTaskbar: boolean
}

export interface BubbleConfig {
  /** Center, normalized to the display (0..1). */
  x: number
  y: number
  /** Diameter in DIP. */
  size: number
}

export interface Settings {
  saveFolder: string
  cameraDeviceId: string
  micDeviceId: string
  cameraEnabled: boolean
  micEnabled: boolean
  systemAudio: boolean
  countdown: boolean
  resolution: 720 | 1080 | 1440
  fps: 30 | 60
  studioForScreen: boolean
  studioForWindow: boolean
  /** Padding around the captured frame in studio mode, fraction of output height. */
  studioPadding: number
  cornerRadius: number
  background: BackgroundConfig
  cleanDesktopEnabled: boolean
  cleanDesktop: CleanDesktopConfig
  maskPasswords: boolean
  cropBrowserChrome: boolean
  bubble: BubbleConfig
  lastMode: CaptureMode
}

export interface StartOptions {
  mode: CaptureMode
  sourceId: string | null
  sourceName?: string
  camera: boolean
  mic: boolean
  systemAudio: boolean
  studio: boolean
  cleanDesktop: boolean
  /** desktopCapturer window ids that stay visible when clean desktop minimizes windows. */
  keepWindowIds: string[]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CameraLayout {
  x: number
  y: number
  /** Diameter as a fraction of output height. */
  size: number
}

export interface Layout {
  crop: Rect | null
  camera: CameraLayout | null
}

export interface RecorderConfig {
  options: StartOptions
  settings: Settings
  layout: Layout
}

export type RecStatus = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'processing'

export interface RecState {
  status: RecStatus
  startedAt: number | null
  pausedMs: number
  pausedAt: number | null
  error: string | null
  lastSaved: string | null
}

export interface SourceInfo {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
  appIcon: string | null
  displayId: string
}

export interface VideoItem {
  path: string
  name: string
  size: number
  createdAt: number
  duration: number | null
  thumb: string | null
}

export interface ExtensionInfo {
  chromeId: string
  firefoxId: string
  chromeFolder: string
  firefoxFolder: string
  hostRegistered: boolean
  hostError: string | null
  connected: string[]
}

/** Browser viewport data reported by the extension, in CSS/DIP pixels. */
export interface ViewportInfo {
  screenX: number
  screenY: number
  outerWidth: number
  outerHeight: number
  innerWidth: number
  innerHeight: number
  zoom: number
}

export const MEDIA_SCHEME = 'lcmedia'

export function mediaUrl(p: string): string {
  return `${MEDIA_SCHEME}://file/?p=${encodeURIComponent(p)}`
}
