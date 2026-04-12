import { describe, expect, it } from 'vitest'
import { createThreadSchema, markReadSchema, sendMessageSchema } from '../../src/validators/message'

describe('createThreadSchema', () => {
  const validInput = {
    participantIds: ['user-1', 'user-2'],
  }

  it('accepts valid input with participantIds only', () => {
    const result = createThreadSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts valid input with bookingId', () => {
    const result = createThreadSchema.safeParse({
      ...validInput,
      bookingId: 'booking-1',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.bookingId).toBe('booking-1')
    }
  })

  it('rejects missing participantIds', () => {
    const result = createThreadSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty participantIds array', () => {
    const result = createThreadSchema.safeParse({ participantIds: [] })
    expect(result.success).toBe(false)
  })

  it('rejects participantIds with empty string', () => {
    const result = createThreadSchema.safeParse({ participantIds: [''] })
    expect(result.success).toBe(false)
  })

  it('allows bookingId to be omitted', () => {
    const result = createThreadSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.bookingId).toBeUndefined()
    }
  })
})

describe('sendMessageSchema', () => {
  const valid = { senderId: 'user-1', content: 'Hello!' }

  it('accepts valid input', () => {
    const result = sendMessageSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderId).toBe('user-1')
      expect(result.data.content).toBe('Hello!')
    }
  })

  it('rejects missing senderId', () => {
    const result = sendMessageSchema.safeParse({ content: 'Hello!' })
    expect(result.success).toBe(false)
  })

  it('rejects empty senderId', () => {
    const result = sendMessageSchema.safeParse({ senderId: '', content: 'Hello!' })
    expect(result.success).toBe(false)
  })

  it('rejects empty string content', () => {
    const result = sendMessageSchema.safeParse({ ...valid, content: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only content', () => {
    const result = sendMessageSchema.safeParse({ ...valid, content: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects content over 5000 characters', () => {
    const result = sendMessageSchema.safeParse({ ...valid, content: 'a'.repeat(5001) })
    expect(result.success).toBe(false)
  })

  it('accepts content of exactly 5000 characters', () => {
    const result = sendMessageSchema.safeParse({ ...valid, content: 'a'.repeat(5000) })
    expect(result.success).toBe(true)
  })

  it('trims whitespace from content', () => {
    const result = sendMessageSchema.safeParse({ ...valid, content: '  Hello!  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.content).toBe('Hello!')
    }
  })

  it('rejects missing content', () => {
    const result = sendMessageSchema.safeParse({ senderId: 'user-1' })
    expect(result.success).toBe(false)
  })
})

describe('markReadSchema', () => {
  it('accepts valid userId', () => {
    const result = markReadSchema.safeParse({ userId: 'user-1' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userId).toBe('user-1')
    }
  })

  it('rejects missing userId', () => {
    const result = markReadSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty userId', () => {
    const result = markReadSchema.safeParse({ userId: '' })
    expect(result.success).toBe(false)
  })
})
