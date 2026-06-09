import type { feeSchedules } from '../schema'

/**
 * Slice 8 demo fee schedules (#390, §3.4). Each operator gets the three MVP fee
 * types operator-wide; Best Car Rental also sets a higher per-class overtime fee
 * on its SUV class to exercise the composite-FK seal (fee_schedules_operator_class_fk)
 * and the per-class path. feeType<->unit coherence (OVERTIME_HOURLY=>PER_HOUR,
 * *_FLAT=>FLAT) is NOT enforced by a DB CHECK — the fixtures set coherent pairs
 * explicitly (schema.ts note); a direct seed write of an incoherent pair would persist.
 */
type FeeRow = typeof feeSchedules.$inferInsert

export type DemoFeeSchedule = Pick<
  FeeRow,
  'id' | 'operatorId' | 'vehicleClassId' | 'feeType' | 'unit' | 'amountJpy'
> & {
  readonly id: string
  readonly operatorId: string
  readonly feeType: FeeRow['feeType']
  readonly unit: FeeRow['unit']
  readonly amountJpy: number
}

const OPERATOR_IDS = ['op_best_car_rental', 'op_kansai_drive', 'op_sakura_mobility'] as const

// The three operator-wide fees every operator carries, with coherent units.
const operatorWideFees = (operatorId: string): DemoFeeSchedule[] => [
  {
    id: `fee_${operatorId}_overtime`,
    operatorId,
    feeType: 'OVERTIME_HOURLY',
    unit: 'PER_HOUR',
    amountJpy: 1000,
  },
  {
    id: `fee_${operatorId}_cleaning`,
    operatorId,
    feeType: 'CLEANING_FLAT',
    unit: 'FLAT',
    amountJpy: 5000,
  },
  {
    id: `fee_${operatorId}_nofuel`,
    operatorId,
    feeType: 'NO_FUEL_FLAT',
    unit: 'FLAT',
    amountJpy: 3000,
  },
]

export const DEMO_FEE_SCHEDULES: readonly DemoFeeSchedule[] = [
  ...OPERATOR_IDS.flatMap(operatorWideFees),
  // Per-class overtime: Best Car Rental's SUV (cls_best_suv) costs more per hour.
  {
    id: 'fee_op_best_car_rental_overtime_suv',
    operatorId: 'op_best_car_rental',
    vehicleClassId: 'cls_best_suv',
    feeType: 'OVERTIME_HOURLY',
    unit: 'PER_HOUR',
    amountJpy: 1500,
  },
] as const
