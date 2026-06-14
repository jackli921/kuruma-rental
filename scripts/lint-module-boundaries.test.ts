import { describe, expect, test } from 'bun:test'
import { checkImports } from './lint-module-boundaries'

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
