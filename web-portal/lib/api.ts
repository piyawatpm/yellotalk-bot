let _resolvedApiUrl: string | null = null

// Optional manual override (handy for remote/dev): set localStorage 'yt-api-url'
// to a full origin, e.g. http://localhost:5355, to point the portal there.
function override(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('yt-api-url')
  } catch {
    return null
  }
}

/** Synchronous best-guess of the bot-server origin (host:5353). */
export function getApiUrl(): string {
  const o = override()
  if (o) return o
  if (_resolvedApiUrl) return _resolvedApiUrl
  if (typeof window === 'undefined') return 'http://localhost:5353'
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:5353'
  return `http://${h}:5353`
}

/** Resolves the bot-server origin, discovering the tunnel URL when remote. */
export async function resolveApiUrl(): Promise<string> {
  const o = override()
  if (o) return o
  if (_resolvedApiUrl) return _resolvedApiUrl
  if (typeof window === 'undefined') return 'http://localhost:5353'
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1' || /^(10|172|192)\.\d/.test(h)) {
    _resolvedApiUrl = getApiUrl()
    return _resolvedApiUrl
  }
  try {
    const resp = await fetch('/api/tunnel-url')
    const data = await resp.json()
    if (data.url) {
      _resolvedApiUrl = data.url
      return data.url
    }
  } catch {}
  _resolvedApiUrl = getApiUrl()
  return _resolvedApiUrl
}
