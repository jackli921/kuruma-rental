import { describe, expect, it } from 'vitest'
import type { ThreadSummaryDto } from './api'
import { countOperatorUnread, countUnread } from './unread-badge'

function thread(
  id: string,
  participants: { userId: string; unreadCount: number }[],
  operatorUnreadCount = 0,
): ThreadSummaryDto {
  return {
    id,
    bookingId: `bk_${id}`,
    operatorUnreadCount,
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

describe('countOperatorUnread', () => {
  it('sums the tenant-level operatorUnreadCount across every thread', () => {
    const threads = [thread('1', [], 2), thread('2', [], 3), thread('3', [], 0)]
    expect(countOperatorUnread(threads)).toBe(5)
  })

  it('ignores per-participant unread (operator unread lives on the thread)', () => {
    const threads = [thread('1', [{ userId: ME, unreadCount: 9 }], 0)]
    expect(countOperatorUnread(threads)).toBe(0)
  })

  it('is 0 for an empty inbox', () => {
    expect(countOperatorUnread([])).toBe(0)
  })
})
