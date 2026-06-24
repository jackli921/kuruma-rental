import type { classRatePlans } from '../schema'

/**
 * Demo CLASS_COMBO rate plans (#464 §5.1). A combo books a vehicle *class* (no
 * specific car at book time) and is priced off its class rate plan, keyed per
 * (operator, class, pickupLocation). The day rates here are deliberately set
 * BELOW the cheapest specific car in each class so the combo reads as a real
 * "deal". Best Car Rental's Namba store bootstraps the feature; the operator
 * CRUD surface (slice 6) lets others add their own. Composite FK
 * (operatorId, classId) -> vehicleClasses + pickupLocationId -> locations, so
 * all three ids must reference rows the seed already wrote (classes, locations).
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
  readonly label: string
}

export const DEMO_CLASS_RATE_PLANS: readonly DemoClassRatePlan[] = [
  {
    id: 'crp_best_kei_namba',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_namba',
    dayRateJpy: 6000,
    label: 'Kei Class Deal — Namba',
  },
  {
    id: 'crp_best_compact_namba',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_namba',
    dayRateJpy: 8000,
    label: 'Compact Class Deal — Namba',
  },
  {
    id: 'crp_best_suv_namba',
    operatorId: 'op_best_car_rental',
    classId: 'cls_best_suv',
    pickupLocationId: 'loc_best_namba',
    dayRateJpy: 14000,
    label: 'SUV Class Deal — Namba',
  },
] as const
