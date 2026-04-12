import { describe, expect, test } from 'bun:test'
import { checkFiles } from './lint-file-size'

const FIXTURES = 'scripts/__fixtures__/lint'

describe('lint-file-size', () => {
  test('reports a hard failure for a file over 800 lines', () => {
    const report = checkFiles([`${FIXTURES}/big-file.ts`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.file).toBe(`${FIXTURES}/big-file.ts`)
    expect(errors[0]!.lines).toBe(900)
    expect(errors[0]!.cap).toBe(800)
  })

  test('does not report a small file', () => {
    const report = checkFiles([`${FIXTURES}/small-file.ts`])
    expect(report).toHaveLength(0)
  })

  test('reports a soft warning for a file between 400 and 800 lines', () => {
    const report = checkFiles([`${FIXTURES}/medium-file.ts`])
    const warnings = report.filter((r) => r.level === 'warn')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.file).toBe(`${FIXTURES}/medium-file.ts`)
    expect(warnings[0]!.lines).toBe(500)
    expect(warnings[0]!.cap).toBe(400)
  })

  test('enforces 150-line cap on modules/*/routes.ts', () => {
    const report = checkFiles([`${FIXTURES}/modules/demo/routes.ts`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.cap).toBe(150)
    expect(errors[0]!.lines).toBe(200)
  })

  test('enforces 80-line cap on app/**/page.tsx', () => {
    const report = checkFiles([`${FIXTURES}/app/locale/demo/page.tsx`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.cap).toBe(80)
    expect(errors[0]!.lines).toBe(100)
  })

  test('exempts allowlisted legacy pages from the 80-line cap', () => {
    const legacyFixture = 'packages/web/src/app/[locale]/vehicles/page.tsx'
    const report = checkFiles([legacyFixture])
    const errors = report.filter((r) => r.level === 'error')
    // File is 106 lines; not over 800 hard cap and not over 400 soft warn for
    // general files means zero errors and zero warnings.
    expect(errors).toHaveLength(0)
  })
})
