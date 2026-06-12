import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import type { Context, MiddlewareHandler } from 'hono'
import { fail } from './helpers'

/**
 * Resolve the caller's IP: Cloudflare's `cf-connecting-ip` first, then the
 * `x-forwarded-for` lead hop, then `x-real-ip`. Returns null when none is
 * present so callers can decide policy rather than silently coalescing to ''.
 */
export function clientIp(c: Context): string | null {
  const cf = c.req.header('cf-connecting-ip')
  if (cf) return cf
  const xff = c.req.header('x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim() || null
  return c.req.header('x-real-ip') ?? null
}

/**
 * Per-IP rate limit that FAILS CLOSED (#563). The underlying limiter bypasses
 * rate limiting entirely on an empty key, so an indeterminate IP must 429 here
 * rather than fall through to a shared '' bucket on a brute-forceable endpoint.
 * On real Cloudflare `cf-connecting-ip` is always present; a null IP signals a
 * misconfiguration, and refusing is the safe default.
 */
export function rateLimitByIp(limiter: RateLimitBinding): MiddlewareHandler {
  const limited = rateLimit(limiter, (c) => clientIp(c) ?? '')
  return async (c, next) => {
    if (clientIp(c) === null) return fail(c, 'Too many requests', 429)
    return limited(c, next)
  }
}
