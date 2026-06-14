import {
  BEST_CAR_RENTAL_OPERATOR_ID,
  SECOND_RENTER_EMAIL,
  SECOND_RENTER_ID,
  SECOND_RENTER_LANGUAGE,
  SECOND_RENTER_NAME,
} from '../constants'
import type { BookingStatus } from '../schema'

/**
 * Slice 8 demo bookings (#390, §3.5). Pure descriptors: each references a seeded
 * operator + class + (optional) insurance option by their stable fixture ids and
 * a renter persona; the `seed-bookings.ts` builder resolves a concrete AVAILABLE
 * vehicle, computes demo-time-relative timestamps, snapshots insurance/fees, and
 * appends the booking_events + notification_log rows.
 *
 * Booking codes are static, hand-authored from the no-confusables alphabet
 * (2-9A-HJ-NP-Z, plan §5 item 3). The runtime generator (`generateBookingCode`)
 * lives in `packages/api`, which `@kuruma/shared` must not import (AGENTS.md
 * boundary), so demo rows carry literal codes from the same alphabet — unique,
 * and matching the E2E regex so the operator-portal assertion reads identically.
 */
export interface DemoRenter {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly language: string
}

// `@example.test` so cleanup greps cleanly and they never collide with real
// OAuth users (same convention as the legacy seed). Stable ids so bookings
// reference renterId deterministically.
export const DEMO_RENTERS: readonly DemoRenter[] = [
  {
    id: SECOND_RENTER_ID,
    email: SECOND_RENTER_EMAIL,
    name: SECOND_RENTER_NAME,
    language: SECOND_RENTER_LANGUAGE,
  },
  { id: 'usr_renter_wei', email: 'wei@example.test', name: 'Chen Wei', language: 'zh' },
  { id: 'usr_renter_sarah', email: 'sarah@example.test', name: 'Sarah Smith', language: 'en' },
  { id: 'usr_renter_hiroshi', email: 'hiroshi@example.test', name: 'Sato Hiroshi', language: 'ja' },
] as const

export interface DemoBooking {
  readonly id: string
  readonly bookingCode: string
  readonly renterId: string
  readonly operatorId: string
  readonly classId: string
  readonly insuranceOptionId: string | null
  // Demo-time-relative window: start = today + startOffsetDays at startHour:00.
  readonly startOffsetDays: number
  readonly startHour: number
  readonly durationHours: number
  readonly status: BookingStatus
  readonly totalPriceJpy: number
  // true => assigned vehicle differs from requested (same operator+class); emits
  // a VEHICLE_SUBSTITUTED event to demo the substitution audit trail (§9 item 25).
  readonly substitute: boolean
}

// A spread across all 3 operators, all 4 statuses, all 3 renter locales, and
// exactly one substitution. CONFIRMED/ACTIVE rows occupy their assigned vehicle
// (exclusion constraint), so the builder assigns each a DISTINCT vehicle.
export const DEMO_BOOKINGS: readonly DemoBooking[] = [
  {
    id: 'bk_demo_best_compact',
    bookingCode: 'H7K2M9PQ',
    renterId: 'usr_renter_yui',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: 'cls_best_compact',
    insuranceOptionId: 'ins_best_premium',
    startOffsetDays: 2,
    startHour: 10,
    durationHours: 48,
    status: 'CONFIRMED',
    totalPriceJpy: 18000,
    substitute: false,
  },
  {
    id: 'bk_demo_best_suv_sub',
    bookingCode: 'B4N8RXY2',
    renterId: 'usr_renter_wei',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: 'cls_best_suv',
    insuranceOptionId: 'ins_best_normal',
    startOffsetDays: 0,
    startHour: 9,
    durationHours: 10,
    status: 'ACTIVE',
    totalPriceJpy: 14000,
    substitute: true,
  },
  {
    id: 'bk_demo_best_sedan',
    bookingCode: 'C3P9JKLM',
    renterId: 'usr_renter_sarah',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: 'cls_best_sedan',
    insuranceOptionId: 'ins_best_normal',
    startOffsetDays: -5,
    startHour: 9,
    durationHours: 24,
    status: 'COMPLETED',
    totalPriceJpy: 9500,
    substitute: false,
  },
  {
    id: 'bk_demo_best_kei_cancelled',
    bookingCode: 'H9M3PQRS',
    renterId: 'usr_renter_hiroshi',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: 'cls_best_kei',
    insuranceOptionId: null,
    startOffsetDays: -1,
    startHour: 14,
    durationHours: 4,
    status: 'CANCELLED',
    totalPriceJpy: 6500,
    substitute: false,
  },
  {
    id: 'bk_demo_kansai_economy',
    bookingCode: 'D5R7TYUV',
    renterId: 'usr_renter_hiroshi',
    operatorId: 'op_kansai_drive',
    classId: 'cls_kansai_economy',
    insuranceOptionId: 'ins_kansai_normal',
    startOffsetDays: 1,
    startHour: 10,
    durationHours: 8,
    status: 'CONFIRMED',
    totalPriceJpy: 8000,
    substitute: false,
  },
  {
    id: 'bk_demo_kansai_van',
    bookingCode: 'E6S8WXZ2',
    renterId: 'usr_renter_yui',
    operatorId: 'op_kansai_drive',
    classId: 'cls_kansai_van',
    insuranceOptionId: 'ins_kansai_premium',
    startOffsetDays: 3,
    startHour: 13,
    durationHours: 24,
    status: 'CONFIRMED',
    totalPriceJpy: 22000,
    substitute: false,
  },
  {
    id: 'bk_demo_kansai_intermediate',
    bookingCode: 'J2N4TUVW',
    renterId: 'usr_renter_yui',
    operatorId: 'op_kansai_drive',
    classId: 'cls_kansai_intermediate',
    insuranceOptionId: 'ins_kansai_normal',
    startOffsetDays: -3,
    startHour: 9,
    durationHours: 8,
    status: 'COMPLETED',
    totalPriceJpy: 9500,
    substitute: false,
  },
  {
    id: 'bk_demo_sakura_compact',
    bookingCode: 'F7T9ABCD',
    renterId: 'usr_renter_wei',
    operatorId: 'op_sakura_mobility',
    classId: 'cls_sakura_compact',
    insuranceOptionId: 'ins_sakura_normal',
    startOffsetDays: 0,
    startHour: 14,
    durationHours: 6,
    status: 'ACTIVE',
    totalPriceJpy: 6500,
    substitute: false,
  },
  {
    id: 'bk_demo_sakura_premium_van',
    bookingCode: 'G8K2HJNP',
    renterId: 'usr_renter_sarah',
    operatorId: 'op_sakura_mobility',
    classId: 'cls_sakura_premium_van',
    insuranceOptionId: 'ins_sakura_premium',
    startOffsetDays: 5,
    startHour: 8,
    durationHours: 12,
    status: 'CONFIRMED',
    totalPriceJpy: 24000,
    substitute: false,
  },
  {
    id: 'bk_demo_sakura_fullsuv',
    bookingCode: 'K3P5XYZ2',
    renterId: 'usr_renter_wei',
    operatorId: 'op_sakura_mobility',
    classId: 'cls_sakura_fullsuv',
    insuranceOptionId: 'ins_sakura_normal',
    startOffsetDays: 7,
    startHour: 10,
    durationHours: 6,
    status: 'CONFIRMED',
    totalPriceJpy: 13000,
    substitute: false,
  },
] as const
