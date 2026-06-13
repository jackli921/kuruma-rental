import type { addOnOptions } from '../add-on'

/**
 * Demo add-on catalog (#509 follow-up). Each operator offers a handful of paid
 * extras the renter can pick in the booking wizard's "extras" step; the choice
 * snapshots onto bookings.addOnSnapshot. priceJpy is a FLAT per-booking charge
 * (distinct from insurance's per-day price and from fee_schedules). Name is
 * unique per operator while ACTIVE (add_on_options_active_name_unique). Structure
 * mirrors DEMO_INSURANCE_OPTIONS — operatorId is a seed slug resolved by seedId().
 */
export type DemoAddOnOption = Pick<
  typeof addOnOptions.$inferInsert,
  'id' | 'operatorId' | 'name' | 'description' | 'priceJpy'
> & {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly priceJpy: number
}

export const DEMO_ADD_ON_OPTIONS: readonly DemoAddOnOption[] = [
  // Best Car Rental
  {
    id: 'addon_best_child_seat',
    operatorId: 'op_best_car_rental',
    name: 'Child seat',
    description: 'Rear-facing or booster seat, fitted at pickup.',
    priceJpy: 1100,
  },
  {
    id: 'addon_best_etc_card',
    operatorId: 'op_best_car_rental',
    name: 'ETC card',
    description: 'Expressway toll card — pay tolls automatically, settle on return.',
    priceJpy: 550,
  },
  {
    id: 'addon_best_extra_driver',
    operatorId: 'op_best_car_rental',
    name: 'Additional driver',
    description: 'Register a second named driver on the rental agreement.',
    priceJpy: 1650,
  },
  {
    id: 'addon_best_wifi',
    operatorId: 'op_best_car_rental',
    name: 'Pocket Wi-Fi',
    description: 'Unlimited 4G pocket router for the trip.',
    priceJpy: 770,
  },
  // Kansai Drive
  {
    id: 'addon_kansai_child_seat',
    operatorId: 'op_kansai_drive',
    name: 'Child seat',
    description: 'Rear-facing or booster seat, fitted at pickup.',
    priceJpy: 1000,
  },
  {
    id: 'addon_kansai_etc_card',
    operatorId: 'op_kansai_drive',
    name: 'ETC card',
    description: 'Expressway toll card — pay tolls automatically, settle on return.',
    priceJpy: 500,
  },
  {
    id: 'addon_kansai_snow_tires',
    operatorId: 'op_kansai_drive',
    name: 'Snow tires',
    description: 'Studless winter tires for mountain and snow-country routes.',
    priceJpy: 3300,
  },
  // Sakura Mobility
  {
    id: 'addon_sakura_child_seat',
    operatorId: 'op_sakura_mobility',
    name: 'Child seat',
    description: 'Rear-facing or booster seat, fitted at pickup.',
    priceJpy: 1200,
  },
  {
    id: 'addon_sakura_etc_card',
    operatorId: 'op_sakura_mobility',
    name: 'ETC card',
    description: 'Expressway toll card — pay tolls automatically, settle on return.',
    priceJpy: 600,
  },
  {
    id: 'addon_sakura_gps_en',
    operatorId: 'op_sakura_mobility',
    name: 'English GPS navigation',
    description: 'Dashboard navigation unit with an English voice + map.',
    priceJpy: 880,
  },
] as const
