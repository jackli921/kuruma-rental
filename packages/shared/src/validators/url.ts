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
 * URLs and vehicle/vehicle-class photo arrays. When a length cap is also needed
 * (e.g. class photos' `.max(2048)`), compose `z.string().url().max(n).refine(
 * isHttpUrl, ...)` directly — `.max()` is unavailable on this ZodEffects.
 */
export const httpUrl = z.string().url().refine(isHttpUrl, { message: HTTP_URL_MESSAGE })
