const MAX_RETURN_PATH_LENGTH = 512
const CONTROL_CHAR_MAX = 0x1f
const DEL_CHAR = 0x7f

/**
 * Validate a post-login `returnTo` as a *local* path — the open-redirect defence.
 * Accepts only same-origin root-relative paths (`/en/bookings`); rejects
 * protocol-relative (`//evil`), absolute URLs, backslash tricks (browsers fold
 * `\` to `/`), control chars (CR/LF header injection), and anything not starting
 * with a single `/`. Returns the trusted path, or undefined.
 *
 * Lives in @kuruma/shared so the API (OAuth start/callback) and the web boundary
 * (login route + form action) enforce ONE definition — a security guard checked
 * on both sides of a trust boundary must not be cloned, or the copies drift.
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
