import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// Drift guard for the CSP script-src hash (#500). The CSP in public/_headers
// pins the one inline bootstrap script in index.html by its sha256 hash instead
// of allowing 'unsafe-inline'. The hash is a literal in _headers, so if anyone
// edits the inline script without regenerating it, the browser would silently
// block the script the moment the policy flips from Report-Only to enforcing.
// This recomputes the hash from index.html and fails CI on any mismatch.
//
// Vite emits this non-module inline script byte-identically into dist/index.html
// (verified: source and built hashes match), so hashing the source is correct.

const WEB_ROOT = process.cwd() // vitest runs with cwd = packages/web
const indexHtml = readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8')
const headers = readFileSync(path.join(WEB_ROOT, 'public', '_headers'), 'utf8')

// The inline <script> is the one WITHOUT a src attribute. There must be exactly
// one, or the pinned hash would be ambiguous.
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
const inlineSource = inlineScripts[0]?.[1] ?? ''
const expectedHash = `sha256-${createHash('sha256').update(inlineSource, 'utf8').digest('base64')}`

// Pull the script-src directive out of the CSP line (enforcing OR Report-Only,
// so this keeps guarding after #1009 flips the header name).
const cspLine = headers.split('\n').find((l) => /Content-Security-Policy(-Report-Only)?:/.test(l))
const scriptSrc = cspLine?.match(/script-src ([^;]*)/)?.[1]?.trim() ?? ''

describe('CSP script-src hash (#500)', () => {
  test('index.html has exactly one inline (src-less) script', () => {
    expect(inlineScripts).toHaveLength(1)
  })

  test('_headers pins that inline script by its current sha256', () => {
    expect(scriptSrc).toContain(`'${expectedHash}'`)
  })

  test("script-src drops 'unsafe-inline' (a hash and 'unsafe-inline' cannot coexist)", () => {
    // When a hash is present the browser ignores 'unsafe-inline', so leaving it
    // in is dead config that masks the real policy. Drop it from script-src.
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  test("style-src keeps 'unsafe-inline' (inline style attrs can't be hashed) — #500 note 2", () => {
    const styleSrc = cspLine?.match(/style-src ([^;]*)/)?.[1]?.trim() ?? ''
    expect(styleSrc).toContain("'unsafe-inline'")
  })
})
