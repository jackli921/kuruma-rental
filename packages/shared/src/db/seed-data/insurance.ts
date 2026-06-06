import type { insuranceOptions } from '../schema'

/**
 * Slice 8 demo insurance options (#390, §3.4). Each operator offers two tiers —
 * Normal (150000 deductible) and Premium (250000 deductible) — with an
 * operator-set daily price. At booking (slice 6) the renter picks one and the
 * booking snapshots its name/price/deductible. Active-name uniqueness is scoped
 * per operator (insurance_options_active_name_unique).
 */
export type DemoInsuranceOption = Pick<
  typeof insuranceOptions.$inferInsert,
  'id' | 'operatorId' | 'name' | 'description' | 'dailyPriceJpy' | 'deductibleJpy'
> & {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly dailyPriceJpy: number
  readonly deductibleJpy: number
}

const NORMAL_DEDUCTIBLE_JPY = 150000
const PREMIUM_DEDUCTIBLE_JPY = 250000

export const DEMO_INSURANCE_OPTIONS: readonly DemoInsuranceOption[] = [
  // Best Car Rental
  {
    id: 'ins_best_normal',
    operatorId: 'op_best_car_rental',
    name: 'Normal',
    description: 'Standard collision cover with a 150,000 yen deductible.',
    dailyPriceJpy: 1500,
    deductibleJpy: NORMAL_DEDUCTIBLE_JPY,
  },
  {
    id: 'ins_best_premium',
    operatorId: 'op_best_car_rental',
    name: 'Premium',
    description: 'Lower out-of-pocket cover with a 250,000 yen deductible.',
    dailyPriceJpy: 2800,
    deductibleJpy: PREMIUM_DEDUCTIBLE_JPY,
  },
  // Kansai Drive
  {
    id: 'ins_kansai_normal',
    operatorId: 'op_kansai_drive',
    name: 'Normal',
    description: 'Standard collision cover with a 150,000 yen deductible.',
    dailyPriceJpy: 1400,
    deductibleJpy: NORMAL_DEDUCTIBLE_JPY,
  },
  {
    id: 'ins_kansai_premium',
    operatorId: 'op_kansai_drive',
    name: 'Premium',
    description: 'Lower out-of-pocket cover with a 250,000 yen deductible.',
    dailyPriceJpy: 2600,
    deductibleJpy: PREMIUM_DEDUCTIBLE_JPY,
  },
  // Sakura Mobility
  {
    id: 'ins_sakura_normal',
    operatorId: 'op_sakura_mobility',
    name: 'Normal',
    description: 'Standard collision cover with a 150,000 yen deductible.',
    dailyPriceJpy: 1600,
    deductibleJpy: NORMAL_DEDUCTIBLE_JPY,
  },
  {
    id: 'ins_sakura_premium',
    operatorId: 'op_sakura_mobility',
    name: 'Premium',
    description: 'Lower out-of-pocket cover with a 250,000 yen deductible.',
    dailyPriceJpy: 3000,
    deductibleJpy: PREMIUM_DEDUCTIBLE_JPY,
  },
] as const
