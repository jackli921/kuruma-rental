import { describe, expect, it } from 'vitest'
import type { ThreadSummaryDto } from './api'
import { countUnread } from './unread-badge'

function thread(
  id: string,
  participants: { userId: string; unreadCount: number }[],
): ThreadSummaryDto {
  return {
    id,
    bookingId: `bk_${id}`,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    participants: participants.map((p, i) => ({ id: `tp_${id}_${i}`, threadId: id, ...p })),
    lastMessage: null,
  }
}

const ME = 'user_renter'

describe('countUnread', () => {
  it('sums my own participant unreadCount across every thread', () => {
    const threads = [
      thread('1', [
        { userId: ME, unreadCount: 2 },
        { userId: 'user_op', unreadCount: 9 },
      ]),
      thread('2', [
        { userId: ME, unreadCount: 3 },
        { userId: 'user_op', unreadCount: 0 },
      ]),
    ]
    expect(countUnread(threads, ME)).toBe(5)
  })

  it('ignores the counterpart unreadCount (never counts what the other side has unread)', () => {
    const threads = [thread('1', [{ userId: 'user_op', unreadCount: 7 }])]
    expect(countUnread(threads, ME)).toBe(0)
  })

  it('is 0 for an empty inbox', () => {
    expect(countUnread([], ME)).toBe(0)
  })
})
