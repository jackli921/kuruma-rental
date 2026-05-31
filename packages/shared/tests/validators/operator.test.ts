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
})
