import { describe, expect, it } from 'vitest'
import { sendMessageSchema } from '../../src/validators/message'

describe('sendMessageSchema', () => {
  it('accepts valid content', () => {
    const result = sendMessageSchema.safeParse({ content: 'Hello!' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('Hello!')
    }
  })

  it('rejects empty string content', () => {
    const result = sendMessageSchema.safeParse({ content: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only content', () => {
    const result = sendMessageSchema.safeParse({ content: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects content over 5000 characters', () => {
    const result = sendMessageSchema.safeParse({ content: 'a'.repeat(5001) })
    expect(result.success).toBe(false)
  })

  it('accepts content of exactly 5000 characters', () => {
    const result = sendMessageSchema.safeParse({ content: 'a'.repeat(5000) })
    expect(result.success).toBe(true)
  })

  it('trims whitespace from content', () => {
    const result = sendMessageSchema.safeParse({ content: '  Hello!  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('Hello!')
    }
  })

  it('rejects missing content', () => {
    const result = sendMessageSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
