import { customAlphabet } from 'nanoid'

// Slice 6 (#392), proposal §10 item 3. Human-facing reservation code: 8-char
// no-confusables base32, generated server-side and recitable over the phone.
// The alphabet drops the visually ambiguous 0 O 1 I (and l, absent here since
// it is uppercase-only). Exactly the characters in BOOKING_CODE_PATTERN.
// ~32^8 ≈ 2^40 space — collisions are astronomically rare at MVP scale but the
// `bookingCode UNIQUE` constraint + service-level regenerate-on-23505 retry
// (§5.4) make a clash safe rather than fatal.
const BOOKING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const BOOKING_CODE_LENGTH = 8

export const BOOKING_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/

const nanoid = customAlphabet(BOOKING_CODE_ALPHABET, BOOKING_CODE_LENGTH)

export function generateBookingCode(): string {
  return nanoid()
}
