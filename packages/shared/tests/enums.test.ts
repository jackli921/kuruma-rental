import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { addOnStatusEnum, catalogTemplateStatusEnum } from '../src/db/add-on'
import {
  operatorMembershipStatusEnum,
  operatorRoleEnum,
  providerInviteStatusEnum,
} from '../src/db/provider-access'
import { regionStatusEnum, regionTypeEnum } from '../src/db/regions'
import { documentStatusEnum, documentTypeEnum } from '../src/db/renter-documents'
import {
  bookingEventTypeEnum,
  bookingFulfillmentModeEnum,
  bookingSourceEnum,
  bookingStatusEnum,
  coordinateSourceEnum,
  feeScheduleStatusEnum,
  feeTypeEnum,
  feeUnitEnum,
  insuranceStatusEnum,
  locationStatusEnum,
  paymentAnomalyKindEnum,
  paymentAnomalyResolutionEnum,
  paymentEventStatusEnum,
  paymentRefundStatusEnum,
  roleEnum,
  transmissionEnum,
  vehicleClassStatusEnum,
  vehicleStatusEnum,
} from '../src/db/schema'
import {
  ADD_ON_STATUSES,
  BOOKING_EVENT_TYPES,
  BOOKING_FULFILLMENT_MODES,
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  CANCELLATION_FEE_SETTLEMENT_STATES,
  CANCELLATION_REASON_CODES,
  CATALOG_TEMPLATE_STATUSES,
  COORDINATE_SOURCES,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  FEE_SCHEDULE_STATUSES,
  FEE_TYPES,
  FEE_UNITS,
  INSURANCE_STATUSES,
  LOCATION_STATUSES,
  OPERATOR_MEMBERSHIP_STATUSES,
  OPERATOR_ROLES,
  PAYMENT_ANOMALY_KINDS,
  PAYMENT_ANOMALY_RESOLUTIONS,
  PAYMENT_EVENT_STATUSES,
  PAYMENT_REFUND_STATUSES,
  PROVIDER_INVITE_STATUSES,
  REGION_STATUSES,
  REGION_TYPES,
  ROLES,
  TRANSMISSIONS,
  VEHICLE_CLASS_STATUSES,
  VEHICLE_STATUSES,
} from '../src/enums'

// The whole point of #688: the enum value arrays in src/enums.ts are the SINGLE
// source the pgEnums consume. If a pgEnum is hand-edited (or an array reordered)
// so the two diverge, the column type silently mismatches the validator. These
// pin every pgEnum's enumValues to its source array by reference-equality of
// content + ORDER (order is contractual — a migration's CREATE TYPE lists values
// positionally). Notification enums are intentionally absent (owned by #710).
describe('enum SSoT — pgEnum.enumValues === src/enums.ts array (#688)', () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    ['role', roleEnum.enumValues, ROLES],
    ['transmission', transmissionEnum.enumValues, TRANSMISSIONS],
    ['vehicle_class_status', vehicleClassStatusEnum.enumValues, VEHICLE_CLASS_STATUSES],
    ['vehicle_status', vehicleStatusEnum.enumValues, VEHICLE_STATUSES],
    ['booking_status', bookingStatusEnum.enumValues, BOOKING_STATUSES],
    ['booking_source', bookingSourceEnum.enumValues, BOOKING_SOURCES],
    ['booking_fulfillment_mode', bookingFulfillmentModeEnum.enumValues, BOOKING_FULFILLMENT_MODES],
    ['booking_event_type', bookingEventTypeEnum.enumValues, BOOKING_EVENT_TYPES],
    ['location_status', locationStatusEnum.enumValues, LOCATION_STATUSES],
    ['coordinate_source', coordinateSourceEnum.enumValues, COORDINATE_SOURCES],
    ['insurance_status', insuranceStatusEnum.enumValues, INSURANCE_STATUSES],
    ['fee_type', feeTypeEnum.enumValues, FEE_TYPES],
    ['fee_unit', feeUnitEnum.enumValues, FEE_UNITS],
    ['fee_schedule_status', feeScheduleStatusEnum.enumValues, FEE_SCHEDULE_STATUSES],
    ['payment_event_status', paymentEventStatusEnum.enumValues, PAYMENT_EVENT_STATUSES],
    ['payment_refund_status', paymentRefundStatusEnum.enumValues, PAYMENT_REFUND_STATUSES],
    ['payment_anomaly_kind', paymentAnomalyKindEnum.enumValues, PAYMENT_ANOMALY_KINDS],
    [
      'payment_anomaly_resolution',
      paymentAnomalyResolutionEnum.enumValues,
      PAYMENT_ANOMALY_RESOLUTIONS,
    ],
    ['add_on_status', addOnStatusEnum.enumValues, ADD_ON_STATUSES],
    ['catalog_template_status', catalogTemplateStatusEnum.enumValues, CATALOG_TEMPLATE_STATUSES],
    ['document_type', documentTypeEnum.enumValues, DOCUMENT_TYPES],
    ['document_status', documentStatusEnum.enumValues, DOCUMENT_STATUSES],
    ['operator_role', operatorRoleEnum.enumValues, OPERATOR_ROLES],
    [
      'operator_membership_status',
      operatorMembershipStatusEnum.enumValues,
      OPERATOR_MEMBERSHIP_STATUSES,
    ],
    ['provider_invite_status', providerInviteStatusEnum.enumValues, PROVIDER_INVITE_STATUSES],
    ['region_type', regionTypeEnum.enumValues, REGION_TYPES],
    ['region_status', regionStatusEnum.enumValues, REGION_STATUSES],
  ]

  for (const [name, enumValues, sourceArray] of cases) {
    it(`${name} enumValues match the SSoT array in order`, () => {
      expect(enumValues).toEqual([...sourceArray])
    })
  }
})

describe('src/enums.ts edge-safety (#688)', () => {
  // enums.ts is reachable from the Next edge bundle (CF Pages, no DB) via the
  // @kuruma/shared/enums subpath, so web can import enum TYPES without dragging
  // in drizzle/postgres. A single import (drizzle / the DB runtime) here would
  // silently re-couple that bundle. The one allowed import is the zero-import
  // sibling lib/luggage (LUGGAGE_SIZES); assert nothing else creeps in.
  it('contains no drizzle/DB imports (only the zero-import lib/luggage re-export)', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/enums.ts', import.meta.url)), 'utf8')
    const importLines = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .split('\n')
      .filter((line) => /\bfrom\s+['"]|\brequire\s*\(|\bimport\s*\(/.test(line))
    // Exactly one import allowed: the LUGGAGE_SIZES re-export from ./lib/luggage.
    expect(importLines).toHaveLength(1)
    expect(importLines[0]).toContain('./lib/luggage')
    // No import line may reach into drizzle / the DB layer (prose may mention it).
    expect(importLines.join('\n')).not.toMatch(/drizzle|\.\/db\/|\.\.\/db\//)
  })
})

// #868 Slice 3a: settlement status of a recorded cancellation fee. Stored as a
// `text` column (NOT a pgEnum — review M4, the lifecycle target churns toward
// #851), so there is no enumValues tripwire; pin the membership + order here.
// ADVISORY is first and load-bearing: it is the column default and every
// pay-at-pickup cancellation today, so reordering must not move it.
describe('cancellation fee settlement states (#868 Slice 3a)', () => {
  it('lists the advisory -> settlement lifecycle, ADVISORY first (the default)', () => {
    expect([...CANCELLATION_FEE_SETTLEMENT_STATES]).toEqual([
      'ADVISORY',
      'CAPTURED',
      'REFUND_DUE',
      'REFUNDED',
      'WAIVED',
    ])
  })
})

// Pins the renter reason taxonomy (#868 Slice 3b). It is a text union, not a
// pgEnum, so nothing else guards it — adding/removing a code here is a deliberate
// product change, and the web reason labels (i18n) must move with it.
describe('cancellation reason codes (#868 Slice 3b)', () => {
  it('lists the owner-approved renter reason taxonomy', () => {
    expect([...CANCELLATION_REASON_CODES]).toEqual([
      'CHANGE_OF_PLANS',
      'FOUND_ALTERNATIVE',
      'TRIP_CANCELLED',
      'VEHICLE_OR_PRICE_CONCERN',
      'OTHER',
    ])
  })
})
