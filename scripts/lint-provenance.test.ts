import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Glob } from 'bun'

/**
 * Authority-provenance guard (#1015): every deterministic governance linter must
 * declare, in a machine-readable header, the rule it ENFORCES and the SSOT where
 * that rule is written down. This makes "which check backs which rule" traceable,
 * and makes the annotation itself enforced rather than prose that rots — the
 * "written != effective" principle applied to our own judicial layer.
 *
 * SSOT must either cite a doc (`*.md § ...`) or honestly mark `code-only` for a
 * rule that has no written home yet (an authority-provenance gap to close).
 */

const EXPLICIT_NON_LINT = ['scripts/db-verify.ts', 'scripts/db-drift-warn.ts']

function governanceLinters(): string[] {
  const found = [...new Glob('scripts/lint-*.ts').scanSync('.')].filter(
    (f) => !f.endsWith('.test.ts'),
  )
  return [...new Set([...found, ...EXPLICIT_NON_LINT])].sort()
}

const ENFORCES = /^\/\/ ENFORCES: \S.+/m
const SSOT = /^\/\/ SSOT: (?:.*\.md\b|code-only\b).+/m

describe('linter authority-provenance headers', () => {
  const linters = governanceLinters()

  test('discovers the governance linter set', () => {
    expect(linters).toContain('scripts/lint-module-boundaries.ts')
    expect(linters).toContain('scripts/db-verify.ts')
    expect(linters.length).toBeGreaterThanOrEqual(11)
  })

  for (const file of linters) {
    test(`${file} declares ENFORCES + a resolvable SSOT`, () => {
      const head = readFileSync(file, 'utf8').split('\n').slice(0, 15).join('\n')
      expect(head).toMatch(ENFORCES)
      expect(head).toMatch(SSOT)
    })
  }
})
