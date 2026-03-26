import { supabase } from './supabase'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((e: unknown) => {
        if (e && typeof e === 'object' && 'msg' in e) {
          const loc = 'loc' in e && Array.isArray((e as { loc: unknown }).loc)
            ? `${(e as { loc: string[] }).loc.join('.')}: `
            : ''
          return `${loc}${String((e as { msg: string }).msg)}`
        }
        return JSON.stringify(e)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return 'API error'
}

export async function apiCall(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body && typeof body === 'object' && 'detail' in body
      ? (body as { detail: unknown }).detail
      : res.statusText
    throw new Error(formatDetail(detail) || `HTTP ${res.status}`)
  }

  return res.json()
}
