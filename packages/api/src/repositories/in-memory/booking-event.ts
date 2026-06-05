import type { CallerContext } from '../../middleware/auth'
import type { BookingEvent } from '../../stores'
import type { BookingEventRepository } from '../types'

// Append-only booking lifecycle log (#392, proposal §5.2). No update/delete by
// contract — the interface omits them. Mirrors the Drizzle table's ordered
// replay (idx_booking_events_bookingId on (bookingId, createdAt)).
export class InMemoryBookingEventRepository implements BookingEventRepository {
  private readonly events: BookingEvent[]

  constructor(events?: BookingEvent[]) {
    this.events = events ?? []
  }

  async append(
    _ctx: CallerContext,
    event: Omit<BookingEvent, 'id' | 'createdAt'>,
  ): Promise<BookingEvent> {
    const appended: BookingEvent = { ...event, id: crypto.randomUUID(), createdAt: new Date() }
    this.events.push(appended)
    return appended
  }

  async findByBookingId(_ctx: CallerContext, bookingId: string): Promise<BookingEvent[]> {
    // Stable sort by createdAt preserves append order for ties (same-ms appends
    // inside one transaction) — the projection consistency invariant (§3.2).
    return this.events
      .filter((e) => e.bookingId === bookingId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }
}
