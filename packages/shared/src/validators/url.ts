import { z } from 'zod'

/** Message shared by every http(s) URL constraint so call sites can't drift. */
export const HTTP_URL_MESSAGE = 'must be an http(s) URL'

/**
 * True for an absolute `http:`/`https:` URL. The security predicate behind every
 * stored, later-rendered URL field: `z.string().url()` alone admits `javascript:`,
 * `data:`, `ftp:`, and the app's own `r2:` photo sentinel — open-redirect / XSS
 * (#386) and cross-tenant photo-spoof (#967) vectors once stored and rendered.
 */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A URL string constrained to the http(s) schemes. Reused by operator handoff
 * URLs and vehicle/vehicle-class photo arrays. When a length cap is also needed,
 * use `httpUrlMax(n)` — `.max()` is a ZodString method, gone once `.refine()`
 * turns this into a ZodEffects, so it can't chain onto `httpUrl`.
 */
export const httpUrl = z.string().url().refine(isHttpUrl, { message: HTTP_URL_MESSAGE })

/**
 * `httpUrl` with a maximum length applied BEFORE the refine (so both the length
 * cap and the http(s)-only guard hold). The single home for the capped shape the
 * photo arrays need — previously re-inlined in vehicle-class.ts, which split the
 * security-critical #967 refine into two copies a future tightening could miss
 * (#1384). Returns the same `string`-output schema, so consumers are unaffected.
 */
export function httpUrlMax(maxLen: number): z.ZodType<string> {
  return z.string().url().max(maxLen).refine(isHttpUrl, { message: HTTP_URL_MESSAGE })
}
