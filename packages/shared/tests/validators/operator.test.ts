import { describe, expect, test } from 'vitest'
import { createOperatorSchema } from '../../src/validators/operator'

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
