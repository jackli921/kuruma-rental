import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// Drift guard for the CSP script-src hash (#500). The CSP in public/_headers
// pins the one inline bootstrap script in index.html by its sha256 hash instead
// of allowing 'unsafe-inline'. The hash is a literal in _headers, so if anyone
// edits the inline script without regenerating it, the browser would silently
// block the script the moment the policy flips from Report-Only to enforcing.
// This recomputes the hash from the SOURCE index.html for fast pre-build
// feedback (this lane runs before `vite build` in CI). The authoritative check
// against the BUILT dist/index.html — the bytes the browser receives — is the
// post-build CI guard scripts/lint-csp-hash.ts, which catches any Vite-emission
// drift this source-level test cannot see.

const WEB_ROOT = process.cwd() // vitest runs with cwd = packages/web
const indexHtml = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8')
const headers = readFileSync(path.join(WEB_ROOT, 'public', '_headers'), 'utf8')

// The inline <script> is the one WITHOUT a src attribute. There must be exactly
// one, or the pinned hash would be ambiguous.
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
const inlineSource = inlineScripts[0]?.[1] ?? ''
const expectedHash = `sha256-${createHash('sha256').update(inlineSource, 'utf8').digest('base64')}`

// Pull the script-src directive out of EVERY CSP line (enforcing AND
// Report-Only, so this keeps guarding after #1009 flips the header name and
// across the enforce-flip rollout where both may briefly coexist — `.find`
// would silently validate only one of them). Anchored on `^\s+` so a `#`
// comment mentioning the directive name can't be parsed instead.
const cspLines = headers
  .split('\n')
  .filter((l) => /^\s+Content-Security-Policy(-Report-Only)?:/.test(l))
const scriptSrcs = cspLines.map((l) => l.match(/script-src ([^;]*)/)?.[1]?.trim() ?? '')
const imgSrcs = cspLines.map((l) => l.match(/img-src ([^;]*)/)?.[1]?.trim() ?? '')

// Non-'self' image hosts the app ACTIVELY loads (both live in beta). Operator
// vehicle photos come from the R2 public bucket (api wrangler.toml
// VEHICLE_PHOTOS_PUBLIC_URL); signed-in avatars come from Google (OAuth
// profile.picture, rendered in nav/UserMenu). An enforcing CSP silently blocks
// any img host it omits, so pin both — an img-src edit that drops one would
// break every vehicle photo / avatar the moment the policy enforces (#500 audit).
const REQUIRED_IMG_HOSTS = [
  'https://pub-a6e9e98522e945a7aa1871f4fe741448.r2.dev',
  'https://lh3.googleusercontent.com',
]

describe('CSP script-src hash (#500)', () => {
  test('index.html has exactly one inline (src-less) script', () => {
    expect(inlineScripts).toHaveLength(1)
  })

  test('_headers carries at least one CSP header with a script-src', () => {
    expect(scriptSrcs.length).toBeGreaterThan(0)
  })

  test('EVERY CSP header pins that inline script by its current sha256', () => {
    for (const scriptSrc of scriptSrcs) expect(scriptSrc).toContain(`'${expectedHash}'`)
  })

  test("EVERY CSP header drops 'unsafe-inline' from script-src (cannot coexist with a hash)", () => {
    for (const scriptSrc of scriptSrcs) expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  test("style-src keeps 'unsafe-inline' (inline style attrs can't be hashed) — #500 note 2", () => {
    for (const line of cspLines) {
      const styleSrc = line.match(/style-src ([^;]*)/)?.[1]?.trim() ?? ''
      expect(styleSrc).toContain("'unsafe-inline'")
    }
  })

  test('serves the CSP as enforcing, not Report-Only (#500 flip)', () => {
    const lines = headers.split('\n')
    const enforcing = lines.filter((l) => /^\s+Content-Security-Policy:/.test(l))
    const reportOnly = lines.filter((l) => /^\s+Content-Security-Policy-Report-Only:/.test(l))
    expect(enforcing).toHaveLength(1)
    expect(reportOnly).toHaveLength(0)
  })

  test('EVERY CSP header allows the active vehicle-photo (R2) + avatar (Google) img hosts', () => {
    expect(imgSrcs.length).toBeGreaterThan(0)
    for (const imgSrc of imgSrcs)
      for (const host of REQUIRED_IMG_HOSTS) expect(imgSrc).toContain(host)
  })
})
