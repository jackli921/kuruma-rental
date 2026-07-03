import type { AvailableVehicleData, ClassOfferingData } from '@/vite/storefronts/api'
import type { VehicleRates } from '@kuruma/shared/lib/pricing'

/**
 * What the reservation wizard is booking (#464). A `SPECIFIC` subject is a
 * concrete car the renter picked; a `CLASS_COMBO` subject is a vehicle class —
 * the operator assigns the exact car before pickup. Both flow through the same
 * wizard; this discriminated union is the single place the two diverge. Pricing
 * and display read through the pure helpers below; the submit path branches on
 * `kind` to build the matching booking discriminant (requestedVehicleId vs classId).
 */
export type ReservationSubject =
  | { readonly kind: 'SPECIFIC'; readonly vehicle: AvailableVehicleData }
  | { readonly kind: 'CLASS_COMBO'; readonly offering: ClassOfferingData }

/** The rate plan the price estimate prices against — a class combo has no hourly rate. */
export function subjectRates(subject: ReservationSubject): VehicleRates {
  return subject.kind === 'SPECIFIC'
    ? { dailyRateJpy: subject.vehicle.dailyRateJpy, hourlyRateJpy: subject.vehicle.hourlyRateJpy }
    : { dailyRateJpy: subject.offering.dailyRateJpy, hourlyRateJpy: subject.offering.hourlyRateJpy }
}

export interface SubjectDisplay {
  /** Vehicle name (SPECIFIC) or class label (CLASS_COMBO). */
  readonly label: string
  /** First photo, or null when the subject has none (noUncheckedIndexedAccess). */
  readonly photo: string | null
  readonly seats: number
}

/** The name, hero photo and seat count the wizard shows for either subject. */
export function subjectDisplay(subject: ReservationSubject): SubjectDisplay {
  return subject.kind === 'SPECIFIC'
    ? {
        label: subject.vehicle.name,
        photo: subject.vehicle.photos[0] ?? null,
        seats: subject.vehicle.seats,
      }
    : {
        label: subject.offering.classLabel,
        photo: subject.offering.photos[0] ?? null,
        seats: subject.offering.seats,
      }
}
