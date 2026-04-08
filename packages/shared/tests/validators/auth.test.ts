import { describe, expect, it } from 'vitest'
import { registerSchema } from '../../src/validators/auth'

describe('registerSchema', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
  }

  it('accepts valid input', () => {
    const result = registerSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects empty email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: '' })
    expect(result.success).toBe(false)
  })

  it('rejects password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: '1234567' })
    expect(result.success).toBe(false)
  })

  it('accepts password of exactly 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: '12345678' })
    expect(result.success).toBe(true)
  })

  it('trims name whitespace', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '  Test User  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Test User')
    }
  })

  it('lowercases email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: 'Test@Example.COM' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('test@example.com')
    }
  })
})
