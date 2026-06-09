const MAX_RETURN_PATH_LENGTH = 512
const CONTROL_CHAR_MAX = 0x1f
const DEL_CHAR = 0x7f

/**
 * Sanitise a post-login `returnTo` as a *local* path — the open-redirect defence
 * at the web boundary. Accepts only same-origin root-relative paths
 * (`/en/bookings`); rejects protocol-relative (`//evil`), absolute URLs,
 * backslash tricks, control chars, and anything not starting with a single `/`.
 *
 * Mirrors the API's `safeReturnPath` (packages/api/src/auth/google.ts): the web
 * validates here so the login form and the already-authenticated redirect only
 * ever carry a trusted path; the API re-validates as defence in depth.
 */
export function safeReturnPath(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) {
    return undefined
  }
  if (raw[0] !== '/') return undefined
  if (raw[1] === '/' || raw[1] === '\\') return undefined
  if (raw.includes('\\')) return undefined
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (code <= CONTROL_CHAR_MAX || code === DEL_CHAR) return undefined
  }
  return raw
}
