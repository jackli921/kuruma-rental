import type { classRatePlans } from '../schema'

/**
 * Class-combo deal rates (#464). A renter can book a *class* at a store — the
 * booking "floats" (no car chosen at book time) and the operator assigns a car
 * by pickup. The rate plan prices the combo on its class (the fleet-rental
 * model); the seeded rates sit below the cheapest member car so the combo reads
 * as a real "deal". Best Car Rental seeds a few. The composite FK
 * (class_rate_plans_operator_class_fk) seals each rate to a class of the SAME
 * operator — classes are already seeded (seed.ts §4) — and a simple FK points
 * pickupLocationId at a seeded location. `isActive` defaults true.
 */
type ClassRatePlanRow = typeof classRatePlans.$inferInsert

export type DemoClassRatePlan = Pick<
  ClassRatePlanRow,
  'id' | 'operatorId' | 'classId' | 'pickupLocationId' | 'dayRateJpy' | 'label'
> & {
  readonly id: string
  readonly operatorId: string
  readonly classId: string
  readonly pickupLocationId: string
  readonly dayRateJpy: number
}

export const DEMO_CLASS_RATE_PLANS: readonly DemoClassRatePlan[] = [
  {
    id: 'crp_best_compact_namba',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_namba',
    dayRateJpy: 6000,
    label: 'Compact class deal — Namba',
  },
  {
    id: 'crp_best_compact_shin_osaka',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_shin_osaka',
    dayRateJpy: 6500,
    label: 'Compact class deal — Shin-Osaka',
  },
  {
    id: 'crp_best_kei_namba',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_namba',
    dayRateJpy: 4500,
    label: 'Kei class deal — Namba',
  },
]
