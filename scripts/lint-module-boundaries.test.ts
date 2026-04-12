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
