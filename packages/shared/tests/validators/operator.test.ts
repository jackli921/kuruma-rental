import { describe, expect, test } from 'vitest'
import { createOperatorSchema, updateOperatorSchema } from '../../src/validators/operator'

describe('createOperatorSchema', () => {
  test('accepts a name and trims it', () => {
    const parsed = createOperatorSchema.parse({ name: '  Best Car Rental  ' })
    expect(parsed.name).toBe('Best Car Rental')
  })

  test('accepts an optional preAuthHandoffUrl', () => {
    const parsed = createOperatorSchema.parse({
      name: 'Acme',
      preAuthHandoffUrl: 'https://pay.acme.example/handoff',
    })
    expect(parsed.preAuthHandoffUrl).toBe('https://pay.acme.example/handoff')
  })

  test('rejects an empty name', () => {
    expect(createOperatorSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  test('rejects a non-URL preAuthHandoffUrl', () => {
    expect(
      createOperatorSchema.safeParse({ name: 'Acme', preAuthHandoffUrl: 'not-a-url' }).success,
    ).toBe(false)
  })

  // preAuthHandoffUrl becomes renter-facing (the pre-auth payment handoff), so
  // a non-web scheme is an open-redirect / XSS vector once something links it.
  test('rejects a javascript: scheme preAuthHandoffUrl', () => {
    expect(
      createOperatorSchema.safeParse({
        name: 'Acme',
        // biome-ignore lint/suspicious/noExplicitAny: testing a hostile value
        preAuthHandoffUrl: 'javascript:alert(1)' as any,
      }).success,
    ).toBe(false)
  })

  test('rejects an ftp: scheme preAuthHandoffUrl', () => {
    expect(
      createOperatorSchema.safeParse({ name: 'Acme', preAuthHandoffUrl: 'ftp://host/file' })
        .success,
    ).toBe(false)
  })

  test('accepts an http: scheme preAuthHandoffUrl', () => {
    expect(
      createOperatorSchema.safeParse({ name: 'Acme', preAuthHandoffUrl: 'http://pay.acme.example' })
        .success,
    ).toBe(true)
  })
})

describe('updateOperatorSchema', () => {
  test('accepts and trims a name-only patch', () => {
    const parsed = updateOperatorSchema.parse({ name: '  Renamed Co  ' })
    expect(parsed).toEqual({ name: 'Renamed Co' })
  })

  test('reuses the create name constraints (max 100)', () => {
    expect(updateOperatorSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
    expect(updateOperatorSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  // 3-state preAuthHandoffUrl semantics — the column is nullable, so the patch
  // must distinguish "leave unchanged" / "clear to NULL" / "set".
  test('absent key leaves the field out of the parsed patch (unchanged)', () => {
    const parsed = updateOperatorSchema.parse({ name: 'X' })
    expect('preAuthHandoffUrl' in parsed).toBe(false)
  })

  test('explicit null is preserved (clear to NULL)', () => {
    const parsed = updateOperatorSchema.parse({ preAuthHandoffUrl: null })
    expect(parsed).toEqual({ preAuthHandoffUrl: null })
  })

  test('accepts an http(s) string', () => {
    const parsed = updateOperatorSchema.parse({ preAuthHandoffUrl: 'https://pay.x.example/h' })
    expect(parsed.preAuthHandoffUrl).toBe('https://pay.x.example/h')
  })

  test('rejects a javascript: scheme (renter-facing, money-flow field)', () => {
    expect(
      updateOperatorSchema.safeParse({
        // biome-ignore lint/suspicious/noExplicitAny: testing a hostile value
        preAuthHandoffUrl: 'javascript:alert(1)' as any,
      }).success,
    ).toBe(false)
  })

  test('rejects an empty patch ({} -> 400)', () => {
    expect(updateOperatorSchema.safeParse({}).success).toBe(false)
  })
})
