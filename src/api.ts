const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')

export function apiUrl(path: string) {
  if (!path.startsWith('/')) {
    throw new Error('API path must start with /')
  }

  return rawApiBaseUrl ? `${rawApiBaseUrl}${path}` : path
}

export const apiBaseUrl = rawApiBaseUrl