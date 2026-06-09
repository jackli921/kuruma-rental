import type { vehicleClasses } from '../schema'

/**
 * Slice 8 demo vehicle classes (#390, §3.3). ACRISS taxonomy spread across the
 * three operators so every storefront returns >=3 distinct class summaries (no
 * single-class fleet). Pricing lives on the vehicle (#406) — classes carry no
 * rate. `slug` is GLOBALLY unique (schema), so the two new operators namespace
 * their slugs; Best Car Rental keeps its existing short slugs. `acrissCode`
 * must match ACRISS_PATTERN (/^[A-Z9]{4}$/); a code may repeat across operators.
 */
type ClassRow = typeof vehicleClasses.$inferInsert

export type DemoVehicleClass = Pick<
  ClassRow,
  | 'id'
  | 'operatorId'
  | 'name'
  | 'slug'
  | 'description'
  | 'acrissCode'
  | 'seats'
  | 'luggageCapacity'
  | 'transmission'
  | 'fuelType'
  | 'sortOrder'
> & {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly slug: string
  readonly acrissCode: string
  readonly seats: number
  readonly luggageCapacity: number
  readonly sortOrder: number
}

export const DEMO_VEHICLE_CLASSES: readonly DemoVehicleClass[] = [
  // Best Car Rental — kei → SUV
  {
    id: 'cls_best_kei',
    operatorId: 'op_best_car_rental',
    name: 'Kei car',
    slug: 'kei',
    acrissCode: 'MCAR',
    description: "Japan's compact kei class — cheapest to rent, easiest to park.",
    seats: 4,
    luggageCapacity: 1,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    sortOrder: 1,
  },
  {
    id: 'cls_best_compact',
    operatorId: 'op_best_car_rental',
    name: 'Compact',
    slug: 'compact',
    acrissCode: 'CCAR',
    description: 'Fuel-efficient compact hatchbacks for city driving and short trips.',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 2,
  },
  {
    id: 'cls_best_sedan',
    operatorId: 'op_best_car_rental',
    name: 'Sedan',
    slug: 'sedan',
    acrissCode: 'SCAR',
    description: 'Comfortable mid-size sedans for longer highway drives.',
    seats: 5,
    luggageCapacity: 3,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 3,
  },
  {
    id: 'cls_best_suv',
    operatorId: 'op_best_car_rental',
    name: 'SUV',
    slug: 'best-suv',
    acrissCode: 'IFAR',
    description: 'Mid-size SUVs for mountain roads and group trips.',
    seats: 5,
    luggageCapacity: 4,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 4,
  },
  // Kansai Drive — economy → van
  {
    id: 'cls_kansai_economy',
    operatorId: 'op_kansai_drive',
    name: 'Economy',
    slug: 'kansai-economy',
    acrissCode: 'ECAR',
    description: 'Efficient economy hatchbacks for budget-conscious renters.',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 1,
  },
  {
    id: 'cls_kansai_intermediate',
    operatorId: 'op_kansai_drive',
    name: 'Intermediate',
    slug: 'kansai-intermediate',
    acrissCode: 'ICAR',
    description: 'Roomier intermediate cars with extra luggage space.',
    seats: 5,
    luggageCapacity: 3,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 2,
  },
  {
    id: 'cls_kansai_suv',
    operatorId: 'op_kansai_drive',
    name: 'SUV',
    slug: 'kansai-suv',
    acrissCode: 'IFAR',
    description: 'All-road SUVs for Kobe and the surrounding hills.',
    seats: 5,
    luggageCapacity: 4,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    sortOrder: 3,
  },
  {
    id: 'cls_kansai_van',
    operatorId: 'op_kansai_drive',
    name: 'Van / MPV',
    slug: 'kansai-van',
    acrissCode: 'PVAR',
    description: 'Spacious 7-seat minivans for families and groups.',
    seats: 7,
    luggageCapacity: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 4,
  },
  // Sakura Mobility — kei → premium van
  {
    id: 'cls_sakura_kei',
    operatorId: 'op_sakura_mobility',
    name: 'Kei car',
    slug: 'sakura-kei',
    acrissCode: 'MCAR',
    description: 'Easy-to-park kei cars for Kyoto and Nara backstreets.',
    seats: 4,
    luggageCapacity: 1,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    sortOrder: 1,
  },
  {
    id: 'cls_sakura_compact',
    operatorId: 'op_sakura_mobility',
    name: 'Compact',
    slug: 'sakura-compact',
    acrissCode: 'CCAR',
    description: 'Nimble compacts for sightseeing day trips.',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 2,
  },
  {
    id: 'cls_sakura_fullsuv',
    operatorId: 'op_sakura_mobility',
    name: 'Full-size SUV',
    slug: 'sakura-fullsuv',
    acrissCode: 'FFAR',
    description: 'Full-size SUVs for larger groups with luggage.',
    seats: 7,
    luggageCapacity: 5,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    sortOrder: 3,
  },
  {
    id: 'cls_sakura_premium_van',
    operatorId: 'op_sakura_mobility',
    name: 'Premium van',
    slug: 'sakura-premium-van',
    acrissCode: 'PVAR',
    description: 'Premium 8-seat vans (Alphard class) for comfort-first groups.',
    seats: 8,
    luggageCapacity: 6,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    sortOrder: 4,
  },
] as const
