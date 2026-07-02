import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import type { Context, MiddlewareHandler } from 'hono'
import { fail } from './helpers'

/**
 * Resolve the caller's IP from Cloudflare's edge-injected `cf-connecting-ip`,
 * or null when absent so callers can decide policy rather than silently
 * coalescing to ''. We deliberately do NOT fall back to `x-forwarded-for` /
 * `x-real-ip`: those are client-controlled, so trusting them as a limiter key
 * would let a caller forge a fresh bucket per request and evade the limit. On
 * the real CF edge `cf-connecting-ip` is always present; its absence means the
 * caller is unidentifiable, and a rate limiter should fail closed on that.
 */
export function clientIp(c: Context): string | null {
  return c.req.header('cf-connecting-ip') ?? null
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

/**
 * Paths exempt from the global per-IP limiter (#1377). `/webhooks/stripe` is
 * signature-gated (`constructEventAsync`) and arrives from a small fixed set of
 * Stripe source IPs that collapse into ONE per-IP bucket — so a per-IP budget
 * there risks 429-dropping money-critical `checkout.session.completed` events,
 * and the signature (not an IP budget) is the real gate. Matched against
 * `c.req.path`, which excludes the query string.
 */
export const RATE_LIMIT_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/webhooks/stripe'])

/**
 * `rateLimitByIp`, but requests whose path is in `exemptPaths` skip the limiter
 * entirely (including the fail-closed 429). The exemption is applied at the
 * composition root so the limiter stays a generic per-IP guard.
 */
export function rateLimitByIpExcept(
  limiter: RateLimitBinding,
  exemptPaths: ReadonlySet<string> = RATE_LIMIT_EXEMPT_PATHS,
): MiddlewareHandler {
  const limited = rateLimitByIp(limiter)
  return async (c, next) => (exemptPaths.has(c.req.path) ? next() : limited(c, next))
}
