import { describe, expect, it } from 'vitest'
import {
  accounts,
  bookingSourceEnum,
  bookingStatusEnum,
  bookings,
  roleEnum,
  sessions,
  transmissionEnum,
  users,
  VALID_BOOKING_TRANSITIONS,
  vehicles,
  verificationTokens,
} from '../../src/db/schema'

describe('schema exports', () => {
  it('exports all table definitions', () => {
    expect(users).toBeDefined()
    expect(accounts).toBeDefined()
    expect(sessions).toBeDefined()
    expect(verificationTokens).toBeDefined()
  })

  it('users table has required columns', () => {
    const columnNames = Object.keys(users)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('role')
    expect(columnNames).toContain('language')
  })

  it('roleEnum contains expected values', () => {
    expect(roleEnum.enumValues).toEqual(['RENTER', 'STAFF', 'ADMIN'])
  })

  it('exports vehicle table with required columns', () => {
    const columnNames = Object.keys(vehicles)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('name')
    expect(columnNames).toContain('seats')
    expect(columnNames).toContain('transmission')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('bufferMinutes')
  })

  it('exports booking table with required columns', () => {
    const columnNames = Object.keys(bookings)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('renterId')
    expect(columnNames).toContain('vehicleId')
    expect(columnNames).toContain('startAt')
    expect(columnNames).toContain('endAt')
    expect(columnNames).toContain('status')
    expect(columnNames).toContain('source')
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

  it('VALID_BOOKING_TRANSITIONS allows CONFIRMED to ACTIVE or CANCELLED', () => {
    expect(VALID_BOOKING_TRANSITIONS.CONFIRMED).toEqual(['ACTIVE', 'CANCELLED'])
  })

  it('VALID_BOOKING_TRANSITIONS prevents transitions from terminal states', () => {
    expect(VALID_BOOKING_TRANSITIONS.COMPLETED).toEqual([])
    expect(VALID_BOOKING_TRANSITIONS.CANCELLED).toEqual([])
  })
})
