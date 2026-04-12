import type { MiddlewareHandler } from 'hono'

/** Minimal KV interface — avoids depending on @cloudflare/workers-types globally. */
export interface KVStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface RateLimitOptions {
  readonly kv: KVStore | undefined
  readonly readLimit: number
  readonly writeLimit: number
  readonly windowSeconds: number
  readonly exemptPaths?: readonly string[]
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { kv, readLimit, writeLimit, windowSeconds, exemptPaths = [] } = options
  const exemptSet = new Set(exemptPaths)

  return async (c, next) => {
    if (!kv || exemptSet.has(c.req.path)) {
      return next()
    }

    // Only trust cf-connecting-ip (set by Cloudflare, cannot be spoofed).
    // If absent (local dev, server-to-server without CF), skip rate limiting
    // rather than sharing a single "unknown" bucket across all clients.
    const ip = c.req.header('cf-connecting-ip')
    if (!ip) {
      return next()
    }

    const isWrite = WRITE_METHODS.has(c.req.method)
    const limit = isWrite ? writeLimit : readLimit
    const windowKey = Math.floor(Date.now() / (windowSeconds * 1000))
    const key = `rl:${ip}:${isWrite ? 'w' : 'r'}:${windowKey}`

    const current = Number.parseInt((await kv.get(key)) ?? '0', 10)

    if (current >= limit) {
      c.header('X-RateLimit-Limit', String(limit))
      c.header('X-RateLimit-Remaining', '0')
      c.header('Retry-After', String(windowSeconds))
      return c.json({ success: false, error: 'Too many requests' }, 429)
    }

    await kv.put(key, String(current + 1), { expirationTtl: windowSeconds })

    c.header('X-RateLimit-Limit', String(limit))
    c.header('X-RateLimit-Remaining', String(limit - current - 1))

    await next()
  }
}
