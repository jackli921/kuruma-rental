import { describe, expect, it } from 'vitest'
import {
  VALID_BOOKING_TRANSITIONS,
  accounts,
  bookingSourceEnum,
  bookingStatusEnum,
  bookings,
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

  it('VALID_BOOKING_TRANSITIONS allows CONFIRMED to ACTIVE or CANCELLED', () => {
    expect(VALID_BOOKING_TRANSITIONS.CONFIRMED).toEqual(['ACTIVE', 'CANCELLED'])
  })

  it('VALID_BOOKING_TRANSITIONS prevents transitions from terminal states', () => {
    expect(VALID_BOOKING_TRANSITIONS.COMPLETED).toEqual([])
    expect(VALID_BOOKING_TRANSITIONS.CANCELLED).toEqual([])
  })
})
