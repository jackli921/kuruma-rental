import { describe, expect, it } from 'vitest'
import { createThreadSchema, sendMessageSchema } from '../../src/validators/message'

const UUID1 = '550e8400-e29b-41d4-a716-446655440001'
const UUID2 = '550e8400-e29b-41d4-a716-446655440002'
const UUID_BOOKING = '550e8400-e29b-41d4-a716-446655440099'

describe('createThreadSchema', () => {
  const validInput = { participantIds: [UUID1, UUID2] }

  it('accepts valid input with participantIds only', () => {
    const result = createThreadSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts valid input with bookingId', () => {
    const result = createThreadSchema.safeParse({ ...validInput, bookingId: UUID_BOOKING })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.bookingId).toBe(UUID_BOOKING)
    }
  })

  it('rejects non-UUID bookingId', () => {
    const result = createThreadSchema.safeParse({ ...validInput, bookingId: 'booking-1' })
    expect(result.success).toBe(false)
  })

  it('rejects non-UUID participantIds', () => {
    const result = createThreadSchema.safeParse({ participantIds: ['not-a-uuid'] })
    expect(result.success).toBe(false)
  })

  it('rejects missing participantIds', () => {
    const result = createThreadSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty participantIds array', () => {
    const result = createThreadSchema.safeParse({ participantIds: [] })
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
  it('accepts content-only (senderId derived from JWT)', () => {
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
