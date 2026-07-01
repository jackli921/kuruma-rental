import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  VALID_BOOKING_TRANSITIONS,
  accounts,
  bookingFulfillmentModeEnum,
  bookingSourceEnum,
  bookingStatusEnum,
  bookings,
  notificationKindEnum,
  notificationStatusEnum,
  roleEnum,
  transmissionEnum,
  users,
  vehicleClasses,
  vehicles,
} from '../../src/db/schema'

describe('schema exports', () => {
  it('exports all table definitions', () => {
    expect(users).toBeDefined()
    expect(accounts).toBeDefined()
  })

  it('users table has required columns', () => {
    const columnNames = Object.keys(users)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('role')
    expect(columnNames).toContain('language')
  })

  it('roleEnum contains expected values', () => {
    // Marketplace tenancy (#386) added OPERATOR_OWNER / OPERATOR_STAFF /
    // PLATFORM_ADMIN alongside the legacy roles.
    expect(roleEnum.enumValues).toEqual([
      'RENTER',
      'STAFF',
      'ADMIN',
      'OPERATOR_OWNER',
      'OPERATOR_STAFF',
      'PLATFORM_ADMIN',
    ])
  })

  it('exports vehicle table with required columns', () => {
    const columnNames = Object.keys(vehicles)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('seats')
    expect(columnNames).toContain('transmission')
    expect(columnNames).toContain('status')
  })

  it('exports booking table with required columns', () => {
    const columnNames = Object.keys(bookings)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('renterId')
    expect(columnNames).toContain('requestedVehicleId')
    expect(columnNames).toContain('assignedVehicleId')
    expect(columnNames).toContain('startAt')
    expect(columnNames).toContain('endAt')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('source')
  })

  it('vehicle_classes table carries the acrissCode column (#388)', () => {
    const columnNames = Object.keys(vehicleClasses)
    expect(columnNames).toContain('acrissCode')
  })

  it('vehicle_classes.acrissCode is nullable (operator-created classes may omit it)', () => {
    expect(vehicleClasses.acrissCode.notNull).toBe(false)
  })

  it('transmissionEnum contains expected values', () => {
    expect(transmissionEnum.enumValues).toEqual(['AUTO', 'MANUAL'])
  })

  it('bookingStatusEnum contains expected values', () => {
    expect(bookingStatusEnum.enumValues).toEqual(['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'])
  })

  it('bookingSourceEnum contains expected values', () => {
    expect(bookingSourceEnum.enumValues).toEqual(['DIRECT', 'TRIP_COM', 'MANUAL', 'OTHER'])
  })

  // #463: fulfillment discriminator. Only SPECIFIC is exercised pre-demo;
  // CLASS_COMBO is the post-demo fast-follow (#464). Order is contractual —
  // the migration's CREATE TYPE must list these in the same order.
  it('bookingFulfillmentModeEnum contains expected values', () => {
    expect(bookingFulfillmentModeEnum.enumValues).toEqual(['SPECIFIC', 'CLASS_COMBO'])
  })

  it('bookings table carries the fulfillmentMode column (#463)', () => {
    expect(Object.keys(bookings)).toContain('fulfillmentMode')
  })

  it('bookings.fulfillmentMode is NOT NULL with a SPECIFIC default (#463)', () => {
    expect(bookings.fulfillmentMode.notNull).toBe(true)
    expect(bookings.fulfillmentMode.default).toBe('SPECIFIC')
  })

  // #463: seals the SPECIFIC => assigned-vehicle invariant. A tautology today
  // (assignedVehicleId is NOT NULL), but #464 makes that column nullable for
  // CLASS_COMBO; this CHECK then keeps SPECIFIC rows honest. Locking its
  // presence here means #464 can't silently drop it.
  it('bookings declares the SPECIFIC-requires-assigned-vehicle CHECK (#463)', () => {
    const checkNames = getTableConfig(bookings).checks.map((c) => c.name)
    expect(checkNames).toContain('bookings_specific_requires_assigned')
  })

  // #710: notification_kind / notification_status are the single source of
  // truth for their respective TS types. Order is contractual — the CREATE TYPE
  // migration lists them in this order, so renaming/reordering an enum value is
  // a deliberate, test-visible change rather than a silent drift that only
  // surfaces as a runtime 22P02 invalid_enum_value insert.
  it('notificationKindEnum contains expected values (#710)', () => {
    expect(notificationKindEnum.enumValues).toEqual([
      'OPERATOR_BOOKING_ALERT',
      'RENTER_BOOKING_CONFIRM',
      'RENTER_SUBSTITUTION',
      'RENTER_CANCELLATION',
      'RENTER_TRIP_STARTED',
      'RENTER_TRIP_COMPLETED',
      'RENTER_REVIEW_PROMPT',
      // #1205 slice 4: operator-facing new-message alert (non-lifecycle kind,
      // dispatched on the operator-unread 0->1 transition, not from a booking trigger).
      'OPERATOR_NEW_MESSAGE',
    ])
  })

  it('notificationStatusEnum contains expected values (#710)', () => {
    expect(notificationStatusEnum.enumValues).toEqual([
      'QUEUED',
      'SENDING',
      'SENT',
      'FAILED',
      'DEAD',
      'NO_RECIPIENT', // #681: terminal non-failure skip (no resolvable email)
    ])
  })

  it('VALID_BOOKING_TRANSITIONS allows CONFIRMED to ACTIVE or CANCELLED', () => {
    expect(VALID_BOOKING_TRANSITIONS.CONFIRMED).toEqual(['ACTIVE', 'CANCELLED'])
  })

  it('VALID_BOOKING_TRANSITIONS prevents transitions from terminal states', () => {
    expect(VALID_BOOKING_TRANSITIONS.COMPLETED).toEqual([])
    expect(VALID_BOOKING_TRANSITIONS.CANCELLED).toEqual([])
  })
})
