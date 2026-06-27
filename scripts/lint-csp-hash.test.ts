import { describe, expect, test } from 'vitest'
import { checkCspHash, cspHash, extractInlineScript, extractScriptSrcs } from './lint-csp-hash'

const SCRIPT = "\n      document.documentElement.lang = 'en';\n    "
const HASH = cspHash(SCRIPT)

function distHtml(inline: string): string {
  return `<!doctype html><html><head><script>${inline}</script><script type="module" src="/assets/x.js"></script></head><body></body></html>`
}

function headersWith(scriptSrc: string): string {
  return [
    '/*',
    '  X-Content-Type-Options: nosniff',
    `  Content-Security-Policy-Report-Only: default-src 'self'; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; base-uri 'self'`,
  ].join('\n')
}

describe('extractInlineScript', () => {
  test('returns the src-less script and ignores the module script', () => {
    expect(extractInlineScript(distHtml(SCRIPT))).toBe(SCRIPT)
  })

  test('returns null when there is no inline script', () => {
    expect(extractInlineScript('<html><script src="/a.js"></script></html>')).toBeNull()
  })

  test('returns null when there is more than one inline script (ambiguous pin)', () => {
    expect(extractInlineScript('<script>a()</script><script>b()</script>')).toBeNull()
  })
})

describe('cspHash', () => {
  test('is the sha256 base64 CSP source-expression of the exact bytes', () => {
    expect(HASH).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
    expect(cspHash('x')).not.toBe(cspHash('y'))
  })
})

describe('extractScriptSrcs', () => {
  test('reads script-src from a Report-Only line, stopping at the next directive', () => {
    expect(extractScriptSrcs(headersWith(`'self' '${HASH}'`))).toEqual([
      { headerName: 'Content-Security-Policy-Report-Only', scriptSrc: `'self' '${HASH}'` },
    ])
  })

  test('binds to the real directive, not a # comment that names it (anti-mask)', () => {
    const withComment = [
      '/*',
      "  # don't put Content-Security-Policy-Report-Only: script-src 'unsafe-inline' in a comment",
      `  Content-Security-Policy-Report-Only: script-src 'self' '${HASH}'; base-uri 'self'`,
    ].join('\n')
    expect(extractScriptSrcs(withComment)).toEqual([
      { headerName: 'Content-Security-Policy-Report-Only', scriptSrc: `'self' '${HASH}'` },
    ])
  })

  test('returns every CSP line during the enforce-flip rollout (both headers may coexist)', () => {
    const headers = [
      '/*',
      `  Content-Security-Policy-Report-Only: script-src 'self' '${HASH}'`,
      `  Content-Security-Policy: script-src 'self' '${HASH}'`,
    ].join('\n')
    expect(extractScriptSrcs(headers).map((d) => d.headerName)).toEqual([
      'Content-Security-Policy-Report-Only',
      'Content-Security-Policy',
    ])
  })
})

describe('checkCspHash', () => {
  test('passes when the served hash is pinned and unsafe-inline is absent', () => {
    const report = checkCspHash(distHtml(SCRIPT), headersWith(`'self' '${HASH}'`))
    expect(report).toEqual({ ok: true, problems: [], servedHash: HASH })
  })

  test('fails on a stale pin (inline script changed but hash did not)', () => {
    const report = checkCspHash(
      distHtml('document.documentElement.lang = "ja";'),
      headersWith(`'self' '${HASH}'`),
    )
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('stale pin')
  })

  test("fails when script-src still allows 'unsafe-inline'", () => {
    const report = checkCspHash(distHtml(SCRIPT), headersWith(`'self' '${HASH}' 'unsafe-inline'`))
    expect(report.ok).toBe(false)
    expect(report.problems.join(' ')).toContain('unsafe-inline')
  })

  test('fails when the built shell has no single inline script', () => {
    const report = checkCspHash('<html><body></body></html>', headersWith(`'self' '${HASH}'`))
    expect(report).toEqual({
      ok: false,
      problems: ['dist/index.html must have exactly one inline (src-less) <script>'],
      servedHash: null,
    })
  })

  // Enforce-flip rollout (#1009): both headers may briefly coexist. The old
  // `.find()` extractor silently validated only one — a stale-pin enforcing
  // header would block the script while the Report-Only side passed CI.
  test('reports stale pins on EVERY CSP header during enforce-flip', () => {
    const headers = [
      '/*',
      `  Content-Security-Policy-Report-Only: script-src 'self' 'sha256-STALE='`,
      `  Content-Security-Policy: script-src 'self' 'sha256-STALE='`,
    ].join('\n')
    const report = checkCspHash(distHtml(SCRIPT), headers)
    expect(report.ok).toBe(false)
    const joined = report.problems.join(' ')
    expect(joined).toContain('Content-Security-Policy-Report-Only')
    expect(joined).toContain('Content-Security-Policy:')
    expect(report.problems.filter((p) => p.includes('stale pin'))).toHaveLength(2)
  })

  test('fails when no CSP directive is present at all', () => {
    const noCsp = '/*\n  X-Content-Type-Options: nosniff'
    const report = checkCspHash(distHtml(SCRIPT), noCsp)
    expect(report.ok).toBe(false)
    expect(report.problems).toContain('no CSP script-src directive found in _headers')
  })
})
