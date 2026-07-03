import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// #500: guards the Report-Only -> enforcing flip. Once flipped, public/_headers
// must ship an ENFORCING `Content-Security-Policy:` header (the browser BLOCKS
// violations, not just reports them) and must NOT still ship the Report-Only
// variant — a lingering Report-Only silently means "not actually enforced".
// The sha256 script pin + style-src 'unsafe-inline' invariants stay guarded by
// csp-script-hash.test.ts; this file guards the header-name flip and the full
// directive set survive it.
const WEB_ROOT = process.cwd() // vitest cwd = packages/web
const headers = readFileSync(path.join(WEB_ROOT, 'public', '_headers'), 'utf8')

// An enforcing line is an indented `Content-Security-Policy:` — the trailing
// colon means it does NOT match `Content-Security-Policy-Report-Only:`. Anchored
// on `^\s+` so a `#` comment naming the header can't be counted as a real one.
const enforcingLines = headers.split('\n').filter((l) => /^\s+Content-Security-Policy:/.test(l))
const reportOnlyLines = headers
  .split('\n')
  .filter((l) => /^\s+Content-Security-Policy-Report-Only:/.test(l))

// The security-relevant directives that must survive the flip unchanged. Kept
// explicit (not derived from the file) so a mutation that weakened one — e.g.
// dropping `object-src 'none'` or widening `frame-ancestors` — fails here.
const REQUIRED_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data: https://images.unsplash.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

describe('CSP is enforcing (#500)', () => {
  test('ships exactly one enforcing Content-Security-Policy header', () => {
    expect(enforcingLines).toHaveLength(1)
  })

  test('no Content-Security-Policy-Report-Only header remains', () => {
    expect(reportOnlyLines).toEqual([])
  })

  test('the enforcing policy carries every required security directive', () => {
    const policy = enforcingLines[0] ?? ''
    for (const directive of REQUIRED_DIRECTIVES) expect(policy).toContain(directive)
  })

  test('the enforcing policy pins the inline script by sha256 (no unsafe-inline in script-src)', () => {
    const policy = enforcingLines[0] ?? ''
    const scriptSrc = policy.match(/script-src ([^;]*)/)?.[1]?.trim() ?? ''
    expect(scriptSrc).toContain("'sha256-")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })
})
