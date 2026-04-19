/**
 * Enforce: every configured locale's `messages/<locale>.json` declares the same
 * set of translation keys. Missing keys render a `MISSING_MESSAGE` error at
 * runtime in next-intl, breaking pages for renters on that locale.
 *
 * Most drift is introduced by merge conflict resolution — the CLAUDE.md gotcha
 * (i18n section) calls this out explicitly. This lint kills the class at
 * commit time.
 *
 * It does NOT check translation *quality* (whether a JA value was actually
 * translated vs copied from EN). That's #364's manual-audit half. Here we
 * just prove parity — the machine-checkable part.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export function flattenKeys(obj: JsonValue, prefix = ''): Set<string> {
  const out = new Set<string>()
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out.add(prefix)
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flattenKeys(v, full)) out.add(nested)
    } else {
      out.add(full)
    }
  }
  return out
}

export interface ParityReport {
  locales: string[]
  keyCount: number
  missingByLocale: Record<string, string[]>
}

export function reportParity(locales: Record<string, Set<string>>): ParityReport {
  const names = Object.keys(locales).sort()
  const union = new Set<string>()
  for (const s of Object.values(locales)) for (const k of s) union.add(k)
  const missingByLocale: Record<string, string[]> = {}
  for (const name of names) {
    const missing: string[] = []
    for (const k of union) if (!locales[name]!.has(k)) missing.push(k)
    if (missing.length > 0) missingByLocale[name] = missing.sort()
  }
  return { locales: names, keyCount: union.size, missingByLocale }
}

export function loadLocales(messagesDir: string): Record<string, Set<string>> {
  const files = readdirSync(messagesDir).filter((f) => f.endsWith('.json'))
  const out: Record<string, Set<string>> = {}
  for (const f of files) {
    const locale = basename(f, '.json')
    const content = JSON.parse(readFileSync(join(messagesDir, f), 'utf8')) as JsonValue
    out[locale] = flattenKeys(content)
  }
  return out
}

function main() {
  const dir = new URL('../packages/web/messages', import.meta.url).pathname
  const locales = loadLocales(dir)
  const report = reportParity(locales)
  const missingCount = Object.values(report.missingByLocale).reduce((a, b) => a + b.length, 0)
  if (missingCount > 0) {
    console.error(
      `[lint-i18n-parity] key drift across ${report.locales.length} locales (${report.keyCount} total keys):`,
    )
    for (const [locale, missing] of Object.entries(report.missingByLocale)) {
      console.error(`\n  ${locale}.json missing ${missing.length} key(s):`)
      for (const k of missing) console.error(`    - ${k}`)
    }
    console.error('\nAdd the missing keys to the offending locale files.')
    process.exit(1)
  }
  console.log(
    `[lint-i18n-parity] all ${report.locales.length} locales have the same ${report.keyCount} keys`,
  )
}

if (import.meta.main) main()
