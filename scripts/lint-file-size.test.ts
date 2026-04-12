import { describe, expect, test } from 'bun:test'
import { capForFile, checkFiles, discoverFiles } from './lint-file-size'

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

  test('reports an error for an unreadable file without crashing', () => {
    // A path that definitely does not exist — readFileSync will throw ENOENT.
    const ghost = 'scripts/__fixtures__/lint/does-not-exist.ts'
    const report = checkFiles([ghost])
    expect(report).toHaveLength(1)
    expect(report[0]!.level).toBe('error')
    expect(report[0]!.file).toBe(ghost)
    expect(report[0]!.message).toMatch(/unreadable/i)
  })
})

describe('lint-file-size discovery', () => {
  test('includes source files under packages/*/src', () => {
    const files = discoverFiles(['packages/web/src'])
    expect(files.length).toBeGreaterThan(0)
    expect(files.every((f) => f.endsWith('.ts') || f.endsWith('.tsx'))).toBe(true)
  })

  test('excludes .test.ts, .test.tsx, node_modules, .next, dist', () => {
    const files = discoverFiles(['packages/web/src'])
    expect(files.some((f) => f.includes('.test.'))).toBe(false)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('/.next/'))).toBe(false)
  })
})

describe('capForFile', () => {
  test('assigns 80-line cap to app pages by default', () => {
    const rule = capForFile('packages/web/src/app/[locale]/something/page.tsx')
    expect(rule.cap).toBe(80)
    expect(rule.soft).toBeNull()
  })

  test('assigns 150-line cap to routes.ts under modules', () => {
    const rule = capForFile('packages/api/src/modules/vehicles/routes.ts')
    expect(rule.cap).toBe(150)
    expect(rule.soft).toBeNull()
  })

  test('exempts pages in the allowlist, falling back to general caps', () => {
    const rule = capForFile(
      'packages/web/src/app/[locale]/test/page.tsx',
      new Set(['packages/web/src/app/[locale]/test/page.tsx']),
    )
    expect(rule.cap).toBe(800)
    expect(rule.soft).toBe(400)
  })

  test('general source files get the 800/400 rule', () => {
    const rule = capForFile('packages/api/src/modules/vehicles/service.ts')
    expect(rule.cap).toBe(800)
    expect(rule.soft).toBe(400)
  })
})
