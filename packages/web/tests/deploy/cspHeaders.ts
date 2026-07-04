import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared by the two CSP deploy guards (csp-enforcing / csp-script-hash), which
// both read these files and filter CSP header lines. Paths resolve relative to
// THIS file, not process.cwd(), so the suite reads the right files from any
// working directory — process.cwd() ENOENTs when vitest runs from the monorepo
// root. Both files sit at the packages/web root, `../..` from tests/deploy.
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function readHeaders(): string {
  return readFileSync(path.join(WEB_DIR, 'public', '_headers'), 'utf8')
}

export function readIndexHtml(): string {
  return readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
}

type CspKind = 'enforcing' | 'report-only' | 'any'

// Indented CSP header lines of the requested kind. `^\s+` keeps a `#` comment
// that names the header from matching; header names are case-insensitive (HTTP +
// Cloudflare), hence /i. The colon straight after `Policy` is what separates an
// enforcing `Content-Security-Policy:` from `...-Report-Only:`.
const CSP_PATTERNS: Record<CspKind, RegExp> = {
  enforcing: /^\s+Content-Security-Policy:/i,
  'report-only': /^\s+Content-Security-Policy-Report-Only:/i,
  any: /^\s+Content-Security-Policy(-Report-Only)?:/i,
}

export function cspLines(headers: string, kind: CspKind): string[] {
  return headers.split('\n').filter((line) => CSP_PATTERNS[kind].test(line))
}
