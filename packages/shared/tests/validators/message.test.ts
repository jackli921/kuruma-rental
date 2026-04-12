import { describe, expect, it } from 'vitest'
import { createThreadSchema, markReadSchema, sendMessageSchema } from '../../src/validators/message'

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
  const valid = { senderId: UUID1, content: 'Hello!' }

  it('accepts valid input', () => {
    const result = sendMessageSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.senderId).toBe(UUID1)
      expect(result.data.content).toBe('Hello!')
    }
  })

  it('rejects non-UUID senderId', () => {
    const result = sendMessageSchema.safeParse({ senderId: 'user-1', content: 'Hello!' })
    expect(result.success).toBe(false)
  })

  it('accepts missing senderId (derived from JWT in routes)', () => {
    const result = sendMessageSchema.safeParse({ content: 'Hello!' })
    expect(result.success).toBe(true)
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
    const result = sendMessageSchema.safeParse({ senderId: UUID1 })
    expect(result.success).toBe(false)
  })
})

describe('markReadSchema', () => {
  it('accepts valid UUID userId', () => {
    const result = markReadSchema.safeParse({ userId: UUID1 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.userId).toBe(UUID1)
    }
  })

  it('rejects non-UUID userId', () => {
    const result = markReadSchema.safeParse({ userId: 'user-1' })
    expect(result.success).toBe(false)
  })

  it('accepts missing userId (derived from JWT in routes)', () => {
    const result = markReadSchema.safeParse({})
    expect(result.success).toBe(true)
  })
})
