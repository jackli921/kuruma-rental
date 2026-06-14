import { describe, expect, test } from 'bun:test'
import {
  checkImports,
  countDeprecatedWebFiles,
  deprecatedTreeStatus,
  formatDeprecationNotice,
  isDeprecatedWebFile,
} from './lint-module-boundaries'

const FIX = 'scripts/__fixtures__/boundaries'

describe('lint-module-boundaries', () => {
  test('flags a cross-module internal import from another module', () => {
    const report = checkImports([`${FIX}/modules/bookings/api.ts`])
    expect(report).toHaveLength(1)
    expect(report[0]!.file).toBe(`${FIX}/modules/bookings/api.ts`)
    expect(report[0]!.importPath).toBe('@/modules/vehicles/api')
    expect(report[0]!.reason).toBe('cross-module-internal')
  })

  test('flags a cross-module internal import from a page', () => {
    const report = checkImports([`${FIX}/app/bad-page.tsx`])
    expect(report).toHaveLength(1)
    expect(report[0]!.importPath).toBe('@/modules/vehicles/components')
  })

  test('allows importing from a module barrel', () => {
    const report = checkImports([`${FIX}/app/good-page.tsx`])
    expect(report).toHaveLength(0)
  })

  test('allows same-module internal imports via the barrel', () => {
    const report = checkImports([`${FIX}/modules/vehicles/index.ts`])
    expect(report).toHaveLength(0)
  })
})

describe('lint-module-boundaries: web no direct DB access (#722)', () => {
  const WEB = `${FIX}/packages/web/src`

  test('flags runtime DB imports in a web file (@/lib/db, drizzle-orm, @kuruma/shared/db)', () => {
    const report = checkImports([`${WEB}/loaders/bad-runtime-db.ts`])
    expect(report).toHaveLength(3)
    expect(report.every((v) => v.reason === 'web-runtime-db')).toBe(true)
    expect(new Set(report.map((v) => v.importPath))).toEqual(
      new Set(['@/lib/db', '@kuruma/shared/db/schema', 'drizzle-orm']),
    )
  })

  test('allows type-only DB imports in a web file (erased at build)', () => {
    expect(checkImports([`${WEB}/loaders/good-type-only.ts`])).toHaveLength(0)
  })

  test('exempts the Auth.js carve-out (auth.ts, lib/db.ts)', () => {
    expect(checkImports([`${WEB}/auth.ts`, `${WEB}/lib/db.ts`])).toHaveLength(0)
  })

  test('does not restrict non-web packages (api may import drizzle at runtime)', () => {
    expect(checkImports([`${FIX}/packages/api/src/uses-drizzle.ts`])).toHaveLength(0)
  })
})

describe('lint-module-boundaries: deprecated web tree ratchet (#719)', () => {
  test('vite/ and components/<feature>/ are deprecated; components/ui/ and other roots are not', () => {
    expect(isDeprecatedWebFile('vite/search/api.ts')).toBe(true)
    expect(isDeprecatedWebFile('components/vehicles/Card.tsx')).toBe(true)
    expect(isDeprecatedWebFile('components/ui/button.tsx')).toBe(false)
    expect(isDeprecatedWebFile('lib/api-base.ts')).toBe(false)
    expect(isDeprecatedWebFile('auth.ts')).toBe(false)
    expect(isDeprecatedWebFile('vite/vite-env.d.ts')).toBe(false) // ambient stub
    expect(isDeprecatedWebFile(null)).toBe(false)
  })

  test('counts only files under deprecated web roots', () => {
    const files = [
      'packages/web/src/vite/search/api.ts',
      'packages/web/src/vite/bookings/list.tsx',
      'packages/web/src/components/vehicles/Card.tsx',
      'packages/web/src/components/ui/button.tsx', // sanctioned — not counted
      'packages/web/src/lib/db.ts', // not deprecated
      'packages/api/src/index.ts', // not web
    ]
    expect(countDeprecatedWebFiles(files)).toBe(3)
  })

  test('status flags growth, shrinkage, or steady against the baseline', () => {
    expect(deprecatedTreeStatus(146, 145).level).toBe('grew')
    expect(deprecatedTreeStatus(144, 145).level).toBe('shrank')
    expect(deprecatedTreeStatus(145, 145).level).toBe('ok')
  })

  test('notice is silent when steady and names the new baseline when it changes', () => {
    expect(formatDeprecationNotice({ count: 145, baseline: 145, level: 'ok' })).toBeNull()
    const grew = formatDeprecationNotice({ count: 146, baseline: 145, level: 'grew' })
    expect(grew).toContain('src/modules/<feature>/')
    expect(grew).toContain('DEPRECATED_WEB_TREE_BASELINE=146')
    const shrank = formatDeprecationNotice({ count: 144, baseline: 145, level: 'shrank' })
    expect(shrank).toContain('DEPRECATED_WEB_TREE_BASELINE=144')
  })
})
