import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// #500: guards the Report-Only -> enforcing flip. Once flipped, public/_headers
// must ship an ENFORCING `Content-Security-Policy:` header (the browser BLOCKS
// violations, not just reports them) and must NOT still ship the Report-Only
// variant — a lingering Report-Only silently means "not actually enforced".
// The sha256 script pin is recomputed from source in csp-script-hash.test.ts;
// this file guards the header-name flip and the exact directive set.
//
// NOTE: csp-script-hash.test.ts deliberately tolerates an enforcing AND a
// Report-Only header coexisting (a staged rollout). This file encodes the END
// STATE and forbids any Report-Only remnant — don't push the coexistence
// rollout past the point this guard lands.
const WEB_ROOT = process.cwd() // vitest runs with cwd = packages/web
const headers = readFileSync(path.join(WEB_ROOT, 'public', '_headers'), 'utf8')

// Header names are case-insensitive (HTTP + Cloudflare), so match with /i. The
// enforcing line is an indented `Content-Security-Policy:` — the colon straight
// after `Policy` is what distinguishes it from `...-Report-Only:`. `^\s+` keeps
// a `#` comment that names the header from being counted as a real one.
const enforcingLines = headers.split('\n').filter((l) => /^\s+Content-Security-Policy:/i.test(l))
const reportOnlyLines = headers
  .split('\n')
  .filter((l) => /^\s+Content-Security-Policy-Report-Only:/i.test(l))

// The EXACT directive set the enforcing policy must ship — compared as a set so
// both a WEAKENED directive (e.g. dropping `object-src 'none'`) AND a WIDENED
// one (e.g. an exfil host appended to `connect-src`) fail here; a `.toContain`
// substring check would miss the addition. Update this deliberately when a real
// origin is added (Sentry ingest #1042, OSM tiles #1423) — that IS the guard.
const EXPECTED_DIRECTIVES = [
  "default-src 'self'",
  // googleusercontent.com serves the signed-in user's Google avatar (session
  // user.image, rendered in UserMenu); Google rotates lh3-lh6, hence the wildcard.
  "img-src 'self' data: https://images.unsplash.com https://*.googleusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'sha256-<pinned>'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

// The exact hash is the sibling's responsibility (recomputed from source), so
// normalize it to a placeholder here — this file guards script-src's SHAPE, not
// the hash value, and so doesn't need editing every time the bootstrap changes.
function parseDirectives(policyLine: string): string[] {
  return policyLine
    .replace(/^\s+Content-Security-Policy:\s*/i, '')
    .split(';')
    .map((d) => d.trim().replace(/'sha256-[A-Za-z0-9+/=]+'/g, "'sha256-<pinned>'"))
    .filter(Boolean)
}

describe('CSP is enforcing (#500)', () => {
  test('ships exactly one enforcing Content-Security-Policy header', () => {
    expect(enforcingLines).toHaveLength(1)
  })

  test('no Content-Security-Policy-Report-Only header remains', () => {
    expect(reportOnlyLines).toEqual([])
  })

  test('the enforcing policy ships exactly the expected directive set (no weaken, no widen)', () => {
    const directives = parseDirectives(enforcingLines[0] ?? '')
    expect([...directives].sort()).toEqual([...EXPECTED_DIRECTIVES].sort())
  })

  test('the enforcing policy pins the inline script by sha256 (no unsafe-inline in script-src)', () => {
    const policy = enforcingLines[0] ?? ''
    const scriptSrc = policy.match(/script-src ([^;]*)/)?.[1]?.trim() ?? ''
    expect(scriptSrc).toContain("'sha256-")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })
})
