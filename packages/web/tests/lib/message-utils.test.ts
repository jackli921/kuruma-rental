import type { ThreadParticipantData, ThreadSummaryData } from '@/lib/message-api'
import { formatRelativeTime, getCounterpartyId, getMyUnreadCount } from '@/lib/message-utils'
import { describe, expect, it } from 'vitest'

const ME = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'
const THIRD = '00000000-0000-4000-8000-0000000000a3'

function participant(userId: string, unreadCount = 0): ThreadParticipantData {
  return { id: `p-${userId}`, threadId: 't1', userId, unreadCount }
}

function thread(participants: ThreadParticipantData[]): ThreadSummaryData {
  return {
    id: 't1',
    bookingId: null,
    idempotencyKey: null,
    createdAt: '2026-04-16T00:00:00Z',
    updatedAt: '2026-04-16T00:00:00Z',
    participants,
    lastMessage: null,
  }
}

describe('getCounterpartyId', () => {
  it('returns the other participant in a 1-on-1 thread', () => {
    const t = thread([participant(ME), participant(OTHER)])
    expect(getCounterpartyId(t, ME)).toBe(OTHER)
  })

  it('returns null when caller is the only participant', () => {
    const t = thread([participant(ME)])
    expect(getCounterpartyId(t, ME)).toBeNull()
  })

  it('returns the first other participant for group threads', () => {
    const t = thread([participant(ME), participant(OTHER), participant(THIRD)])
    expect(getCounterpartyId(t, ME)).toBe(OTHER)
  })
})

describe('getMyUnreadCount', () => {
  it('returns the unread count for the calling user', () => {
    const t = thread([participant(ME, 5), participant(OTHER, 0)])
    expect(getMyUnreadCount(t, ME)).toBe(5)
  })

  it('returns 0 when caller is not a participant', () => {
    const t = thread([participant(OTHER, 3)])
    expect(getMyUnreadCount(t, ME)).toBe(0)
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-16T12:00:00Z')

  it('returns "now" for less than a minute ago', () => {
    expect(formatRelativeTime('2026-04-16T11:59:30Z', 'en', now)).toBe('now')
  })

  it('returns minutes for less than an hour ago', () => {
    expect(formatRelativeTime('2026-04-16T11:55:00Z', 'en', now)).toBe('5m')
  })

  it('returns hours for less than a day ago', () => {
    expect(formatRelativeTime('2026-04-16T09:00:00Z', 'en', now)).toBe('3h')
  })

  it('returns days for less than a week ago', () => {
    expect(formatRelativeTime('2026-04-14T12:00:00Z', 'en', now)).toBe('2d')
  })

  it('uses the supplied locale for the date fallback (>1 week)', () => {
    expect(formatRelativeTime('2026-03-01T12:00:00Z', 'en', now)).toMatch(/Mar/)
    expect(formatRelativeTime('2026-03-01T12:00:00Z', 'ja', now)).toMatch(/3/)
  })
})
