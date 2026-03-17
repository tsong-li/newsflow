const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
const preconnectedOrigins = new Set<string>()

export function apiUrl(path: string) {
  if (!path.startsWith('/')) {
    throw new Error('API path must start with /')
  }

  return rawApiBaseUrl ? `${rawApiBaseUrl}${path}` : path
}

export const apiBaseUrl = rawApiBaseUrl

export function proxiedImageUrl(sourceUrl: string) {
  const value = String(sourceUrl || '').trim()
  if (!value) return ''
  if (!/^https?:/i.test(value)) return value

  const params = new URLSearchParams({ url: value })
  return apiUrl(`/api/image?${params.toString()}`)
}

export function preconnectToUrl(sourceUrl: string) {
  if (typeof document === 'undefined') return

  const value = String(sourceUrl || '').trim()
  if (!/^https?:/i.test(value)) return

  try {
    const origin = new URL(value, window.location.href).origin
    if (!origin || preconnectedOrigins.has(origin)) return

    preconnectedOrigins.add(origin)

    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = origin
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  } catch {
    // Ignore malformed URLs while warming connections.
  }
}

export async function preloadImageUrl(sourceUrl: string) {
  const value = String(sourceUrl || '').trim()
  if (!value || typeof Image === 'undefined') return

  preconnectToUrl(value)

  await new Promise<void>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = value
  })
}

export async function preloadAudioUrl(sourceUrl: string) {
  const value = String(sourceUrl || '').trim()
  if (!value || typeof fetch === 'undefined') return false

  preconnectToUrl(value)

  try {
    const response = await fetch(value, { cache: 'force-cache' })
    return response.ok
  } catch {
    return false
  }
}

export async function preloadVideoAsset(sourceUrl: string, kind: 'iframe' | 'video', posterUrl?: string) {
  if (posterUrl) {
    void preloadImageUrl(posterUrl)
  }

  const value = String(sourceUrl || '').trim()
  if (!value) return

  preconnectToUrl(value)

  if (kind !== 'video' || typeof document === 'undefined') return

  await new Promise<void>((resolve) => {
    const video = document.createElement('video')
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
      resolve()
    }

    video.preload = 'metadata'
    video.muted = true
    video.onloadedmetadata = cleanup
    video.onerror = cleanup
    video.src = value
    video.load()
  })
}