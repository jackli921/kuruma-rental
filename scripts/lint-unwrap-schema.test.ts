import { describe, expect, test } from 'bun:test'
import { countSchemalessUnwraps, reconcile, stripCommentsAndStrings } from './lint-unwrap-schema'

describe('stripCommentsAndStrings', () => {
  test('removes a line comment that mentions unwrap()', () => {
    const src = 'const x = 1 // unwrap() peels one level\nreturn x'
    expect(stripCommentsAndStrings(src)).not.toContain('unwrap')
  })

  test('removes a block comment that mentions unwrap(res, schema)', () => {
    const src = '/* thread unwrap(res, schema) and stay z-free */\ncode'
    const out = stripCommentsAndStrings(src)
    expect(out).not.toContain('unwrap')
    expect(out).toContain('code')
  })

  test('blanks string and template literals so unwrap inside them is ignored', () => {
    const src = "const s = 'call unwrap(res) here'\nconst t = `unwrap(x)`"
    expect(stripCommentsAndStrings(src)).not.toContain('unwrap')
  })

  test('keeps real code outside comments and strings intact', () => {
    const src = 'return unwrap(res, fooSchema)'
    expect(stripCommentsAndStrings(src)).toContain('unwrap(res, fooSchema)')
  })
})

describe('countSchemalessUnwraps', () => {
  test('a single-arg call is schemaless', () => {
    expect(countSchemalessUnwraps('return unwrap(res)')).toBe(1)
  })

  test('an explicit type-arg single-arg call is schemaless', () => {
    expect(countSchemalessUnwraps('return unwrap<AdminRevenueResponse>(res)')).toBe(1)
  })

  test('a two-arg call (schema passed) is validated, not counted', () => {
    expect(countSchemalessUnwraps('return unwrap(res, fooSchema)')).toBe(0)
  })

  test('a schema with a nested call arg is still validated', () => {
    expect(countSchemalessUnwraps('return unwrap(res, fooSchema.array())')).toBe(0)
  })

  test('commas inside the first arg do not fake a second arg', () => {
    // single arg that itself contains parens/commas, but no top-level comma
    expect(countSchemalessUnwraps('return unwrap(pick(a, b))')).toBe(1)
  })

  test('unwrap mentioned in a comment is not counted', () => {
    expect(countSchemalessUnwraps('// unwrap(res) is legacy\nreturn unwrap(res, s)')).toBe(0)
  })

  test('an import of unwrap is not a call', () => {
    expect(countSchemalessUnwraps("import { unwrap } from '@/lib/api-error'")).toBe(0)
  })

  test('counts multiple schemaless calls in one file', () => {
    const src = 'const a = unwrap(r1)\nconst b = unwrap<T>(r2)\nconst c = unwrap(r3, s)'
    expect(countSchemalessUnwraps(src)).toBe(2)
  })

  test('a multi-line validated call is not counted', () => {
    const src = 'return unwrap(\n  res,\n  fooSchema,\n)'
    expect(countSchemalessUnwraps(src)).toBe(0)
  })

  test('a trailing comma after a single arg is still schemaless (no second arg)', () => {
    // biome adds a trailing comma to multi-line calls; it must not read as validated
    expect(countSchemalessUnwraps('unwrap(res,)')).toBe(1)
    expect(countSchemalessUnwraps('unwrap(\n  res,\n)')).toBe(1)
  })

  test('member-access .unwrap(res) is not the helper and is ignored', () => {
    expect(countSchemalessUnwraps('return result.unwrap(res)')).toBe(0)
    expect(countSchemalessUnwraps('return result?.unwrap(res)')).toBe(0)
  })
})

describe('reconcile', () => {
  const allow = { 'admin/revenue/api.ts': 1, 'admin/anomalies/api.ts': 1 }

  test('passes when actual exactly matches the allow-list', () => {
    expect(reconcile(allow, allow)).toEqual([])
  })

  test('flags a schemaless call in a non-allow-listed file as new debt', () => {
    const actual = { ...allow, 'search/api.ts': 1 }
    const messages = reconcile(actual, allow)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('search/api.ts')
    expect(messages[0]).toContain('not on the allow-list')
  })

  test('flags an allow-listed file that gained extra schemaless calls', () => {
    const actual = { ...allow, 'admin/revenue/api.ts': 3 }
    const messages = reconcile(actual, allow)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('admin/revenue/api.ts')
    expect(messages[0]).toContain('expected 1')
    expect(messages[0]).toContain('found 3')
  })

  test('flags an allow-listed file whose schemaless calls dropped (ratchet must shrink)', () => {
    const actual = { 'admin/anomalies/api.ts': 1 } // revenue fully migrated
    const messages = reconcile(actual, allow)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('admin/revenue/api.ts')
    expect(messages[0]).toContain('migrated')
  })

  test('reports every violation, not just the first', () => {
    const actual = { 'search/api.ts': 1 } // both allow entries missing + 1 new
    const messages = reconcile(actual, allow)
    expect(messages).toHaveLength(3)
  })
})
