// Created and developed by Jai Singh
/**
 * UUIDv7 generator + LocalStorage replay cache for retried mutations.
 * Plan §1.5 — every mutation request uses a fresh key; safe to retry the
 * same request with the same key, the server returns the recorded response.
 */

const STORAGE_KEY = 'work_engine_idempotency_cache_v1'
const CACHE_MAX_ENTRIES = 200

interface CachedResponse {
  key: string
  status: number
  body: unknown
  expiresAt: number
}

function loadCache(): Map<string, CachedResponse> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as CachedResponse[]
    const now = Date.now()
    return new Map(arr.filter((e) => e.expiresAt > now).map((e) => [e.key, e]))
  } catch {
    return new Map()
  }
}

function saveCache(c: Map<string, CachedResponse>) {
  try {
    const arr = Array.from(c.values())
    if (arr.length > CACHE_MAX_ENTRIES)
      arr.splice(0, arr.length - CACHE_MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  } catch {
    /* quota exceeded — fine, dropping cache is acceptable */
  }
}

/**
 * UUIDv7 — 48-bit ms timestamp + version + random tail. Plan §1.5 explicitly
 * specifies UUIDv7 for time-ordered idempotency keys.
 */
export function workEngineIdempotencyKey(): string {
  const ts = BigInt(Date.now())
  const tsHex = ts.toString(16).padStart(12, '0')
  const rand = crypto.getRandomValues(new Uint8Array(10))
  // version 7
  rand[0] = (rand[0] & 0x0f) | 0x70
  // variant
  rand[2] = (rand[2] & 0x3f) | 0x80
  const randHex = Array.from(rand)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return (
    `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-` +
    `${randHex.slice(0, 4)}-${randHex.slice(4, 8)}-${randHex.slice(8, 20)}`
  )
}

export function rememberIdempotencyResponse(
  key: string,
  status: number,
  body: unknown,
  ttlMs = 24 * 60 * 60 * 1000
) {
  const cache = loadCache()
  cache.set(key, { key, status, body, expiresAt: Date.now() + ttlMs })
  saveCache(cache)
}

export function getRememberedResponse(key: string): CachedResponse | undefined {
  return loadCache().get(key)
}

// Created and developed by Jai Singh
