const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')

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