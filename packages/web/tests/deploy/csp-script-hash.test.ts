import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { cspLines, readHeaders, readIndexHtml } from './cspHeaders'

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

const indexHtml = readIndexHtml()

// The inline <script> is the one WITHOUT a src attribute. There must be exactly
// one, or the pinned hash would be ambiguous.
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
const inlineSource = inlineScripts[0]?.[1] ?? ''
const expectedHash = `sha256-${createHash('sha256').update(inlineSource, 'utf8').digest('base64')}`

// Pull the script-src directive out of EVERY CSP line — enforcing AND
// Report-Only (cspLines(_, 'any')) — so this keeps guarding after #1009 flips
// the header name and across any rollout where both briefly coexist; checking
// only one would silently validate half the policy.
const cspHeaderLines = cspLines(readHeaders(), 'any')
const scriptSrcs = cspHeaderLines.map((l) => l.match(/script-src ([^;]*)/)?.[1]?.trim() ?? '')

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
    for (const line of cspHeaderLines) {
      const styleSrc = line.match(/style-src ([^;]*)/)?.[1]?.trim() ?? ''
      expect(styleSrc).toContain("'unsafe-inline'")
    }
  })
})
