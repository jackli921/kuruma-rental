import { bookingEvents } from '@kuruma/shared/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import type { BookingEvent } from '../../stores'
import type { BookingEventRepository } from '../types'
import { type Db, bookingEventColumns, toBookingEvent } from './shared'

// Append-only booking lifecycle log (#392, proposal §5.2). No update/delete by
// contract — the interface omits them. Ordered replay per booking via
// idx_booking_events_bookingId on (bookingId, createdAt).
export class DrizzleBookingEventRepository implements BookingEventRepository {
  constructor(private readonly db: Db) {}

  async append(
    _ctx: CallerContext,
    event: Omit<BookingEvent, 'id' | 'createdAt'>,
  ): Promise<BookingEvent> {
    const [inserted] = await this.db
      .insert(bookingEvents)
      .values({
        bookingId: event.bookingId,
        type: event.type,
        payload: event.payload,
        actorId: event.actorId,
      })
      .returning()

    if (!inserted) throw new Error('Failed to append booking event')
    return toBookingEvent(inserted)
  }

  async findByBookingId(_ctx: CallerContext, bookingId: string): Promise<BookingEvent[]> {
    const rows = await this.db
      .select(bookingEventColumns)
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, bookingId))
      .orderBy(asc(bookingEvents.createdAt))

    return rows.map(toBookingEvent)
  }
}
