import { describe, expect, it } from 'vitest'
import type { ThreadSummaryDto } from './api'
import { indexThreadIdsByBooking } from './booking-threads'

function thread(over: Partial<ThreadSummaryDto> = {}): ThreadSummaryDto {
  return {
    id: 'th_1',
    bookingId: 'bk_1',
    operatorUnreadCount: 0,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-23T01:00:00.000Z',
    participants: [],
    lastMessage: null,
    ...over,
  }
}

describe('indexThreadIdsByBooking', () => {
  it('maps each booking id to its thread id, skipping threads with no booking', () => {
    const result = indexThreadIdsByBooking([
      thread({ id: 'th_a', bookingId: 'bk_a' }),
      thread({ id: 'th_b', bookingId: null }),
      thread({ id: 'th_c', bookingId: 'bk_c' }),
    ])
    expect(result).toEqual({ bk_a: 'th_a', bk_c: 'th_c' })
  })
})
