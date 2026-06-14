// #722 OK fixture: type-only DB imports are erased at build — no runtime DB path.
import type { BookingCancelledPayload, BookingStatus } from '@kuruma/shared/db/schema'

export type Row = { status: BookingStatus; payload: BookingCancelledPayload }
