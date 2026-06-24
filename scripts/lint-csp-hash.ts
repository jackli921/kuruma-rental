#!/usr/bin/env bun
// ENFORCES: the CSP script-src hash in packages/web/public/_headers matches the
//   inline bootstrap script as ACTUALLY EMITTED into packages/web/dist/index.html,
//   and that script-src carries no 'unsafe-inline'.
// SSOT: docs/architecture/modules.md § Runtime invariants (Cloudflare Workers) — issue #500.
//
// Why this exists alongside the source-level unit test (tests/deploy/
// csp-script-hash.test.ts): that test hashes the SOURCE index.html for fast
// pre-build feedback. This one runs in CI AFTER `vite build` and hashes the
// BUILT shell — the bytes the browser actually receives. If a Vite upgrade ever
// changed inline-script emission, the served hash would diverge from the pin
// while the source test stayed green, silently blocking the script the moment
// the policy flips to enforcing (#1009). This closes that gap at the real artifact.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const DIST_INDEX = 'packages/web/dist/index.html'
const HEADERS = 'packages/web/public/_headers'

/** The inline <script> is the one WITHOUT a src attribute. Null unless exactly one exists. */
export function extractInlineScript(html: string): string | null {
  const matches = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null
}

/** CSP source-expression hash over the exact script bytes (content between the tags). */
export function cspHash(scriptContent: string): string {
  return `sha256-${createHash('sha256').update(scriptContent, 'utf8').digest('base64')}`
}

/**
 * The script-src directive value from the CSP line (enforcing OR Report-Only).
 * Anchored on `^\s+` so it binds to a real indented `_headers` directive, never a
 * `#` comment that merely mentions the directive name — the guard must survive
 * future explanatory edits to this file without a comment masking a regression.
 */
export function extractScriptSrc(headers: string): string {
  const line = headers
    .split('\n')
    .find((l) => /^\s+Content-Security-Policy(-Report-Only)?:/.test(l))
  return line?.match(/script-src ([^;]*)/)?.[1]?.trim() ?? ''
}

export interface CspHashReport {
  ok: boolean
  problems: string[]
  servedHash: string | null
}

/** Pure: validate a built-HTML + headers pair. Content is supplied by the caller. */
export function checkCspHash(distHtml: string, headers: string): CspHashReport {
  const script = extractInlineScript(distHtml)
  if (script === null)
    return {
      ok: false,
      problems: ['dist/index.html must have exactly one inline (src-less) <script>'],
      servedHash: null,
    }

  const servedHash = cspHash(script)
  const scriptSrc = extractScriptSrc(headers)
  const problems: string[] = []
  if (!scriptSrc.includes(`'${servedHash}'`))
    problems.push(`script-src is missing the served inline-script hash '${servedHash}' (stale pin)`)
  if (scriptSrc.includes("'unsafe-inline'"))
    problems.push("script-src still allows 'unsafe-inline' (it cannot coexist with a hash)")
  return { ok: problems.length === 0, problems, servedHash }
}

function main(): number {
  let distHtml: string
  try {
    distHtml = readFileSync(DIST_INDEX, 'utf8')
  } catch {
    process.stderr.write(
      `[lint-csp-hash] no ${DIST_INDEX} — run \`bun run --filter @kuruma/web build\` first\n`,
    )
    return 1
  }
  const report = checkCspHash(distHtml, readFileSync(HEADERS, 'utf8'))
  if (!report.ok) {
    for (const p of report.problems) process.stderr.write(`[lint-csp-hash] ERROR ${p}\n`)
    process.stderr.write(
      `[lint-csp-hash] fix: recompute the inline-script hash and update script-src in ${HEADERS}\n`,
    )
    return 1
  }
  process.stdout.write(`[lint-csp-hash] OK served inline script pinned by ${report.servedHash}\n`)
  return 0
}

if (import.meta.main) {
  process.exit(main())
}
