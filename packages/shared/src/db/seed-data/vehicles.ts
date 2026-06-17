import type { vehicles } from '../schema'
import { DEMO_VEHICLE_CLASSES } from './classes'

/**
 * Slice 8 demo vehicles (#390, §3.3). 41 vehicles spread across the 3 operators,
 * 9 locations, and 8 ACRISS codes so every storefront card is convincing. Two
 * composite-FK seals hold:
 *   - (operatorId, classId)          -> vehicle_classes  (vehicles_operatorId_classId_fk)
 *   - (operatorId, pickupLocationId) -> locations         (vehicles_operatorId_pickupLocationId_fk)
 * `operatorId` is DERIVED from the class (so the class seal can never drift); the
 * pickup-location seal is a genuine invariant the test guards (a wrong-operator
 * location would slip past construction). Pricing is vehicle-level (#406 dropped
 * class-level rates). The headline credibility floor (§3.3): every location must
 * carry vehicles of >=3 distinct classes, so its per-class availability summary
 * reads as a real fleet, not a single-car listing.
 *
 * `shakenExpiryDate` is intentionally omitted: a frozen date in a static fixture
 * goes stale, so the seed builder stamps a demo-time-relative expiry instead.
 */
type VehicleRow = typeof vehicles.$inferInsert

export type DemoVehicle = Pick<
  VehicleRow,
  | 'id'
  | 'operatorId'
  | 'classId'
  | 'pickupLocationId'
  | 'name'
  | 'make'
  | 'model'
  | 'year'
  | 'color'
  | 'seats'
  | 'transmission'
  | 'fuelType'
  | 'licensePlate'
  | 'dailyRateJpy'
  | 'hourlyRateJpy'
> & {
  readonly id: string
  readonly operatorId: string
  readonly classId: string
  readonly pickupLocationId: string
  readonly name: string
  readonly make: string
  readonly model: string
  readonly seats: number
  readonly transmission: 'AUTO' | 'MANUAL'
  readonly licensePlate: string
  readonly dailyRateJpy: number
  readonly hourlyRateJpy: number
  // Required (not the schema's optional default) so every demo vehicle is forced
  // to carry at least the placeholder — coverage is a fixture invariant, not luck.
  readonly photos: readonly string[]
}

type ModelSpec = { readonly make: string; readonly model: string }

/**
 * Per-class spec every vehicle of that class inherits: seats / transmission /
 * fuel / rates (§3.3 pricing tiers) plus a model pool for credible fleet variety
 * (a fleet has two N-BOXes — models repeat, plates do not). Keyed by class id.
 */
type ClassProfile = {
  readonly seats: number
  readonly transmission: 'AUTO' | 'MANUAL'
  readonly fuelType: string
  readonly dailyRateJpy: number
  readonly hourlyRateJpy: number
  readonly models: readonly ModelSpec[]
}

const CLASS_PROFILE: Record<string, ClassProfile> = {
  // Best Car Rental
  cls_best_kei: {
    seats: 4,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
    models: [
      { make: 'Honda', model: 'N-BOX' },
      { make: 'Suzuki', model: 'Hustler' },
      { make: 'Daihatsu', model: 'Tanto' },
      { make: 'Suzuki', model: 'Wagon R' },
    ],
  },
  cls_best_compact: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
    models: [
      { make: 'Toyota', model: 'Yaris' },
      { make: 'Honda', model: 'Fit' },
      { make: 'Mazda', model: 'Mazda2' },
    ],
  },
  cls_best_sedan: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 12000,
    hourlyRateJpy: 1700,
    models: [
      { make: 'Toyota', model: 'Camry' },
      { make: 'Toyota', model: 'Crown' },
      { make: 'Nissan', model: 'Skyline' },
    ],
  },
  cls_best_suv: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 11500,
    hourlyRateJpy: 1600,
    models: [
      { make: 'Toyota', model: 'RAV4' },
      { make: 'Mazda', model: 'CX-5' },
      { make: 'Honda', model: 'Vezel' },
    ],
  },
  // Kansai Drive
  cls_kansai_economy: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
    models: [
      { make: 'Toyota', model: 'Aqua' },
      { make: 'Nissan', model: 'Note' },
      { make: 'Honda', model: 'Fit' },
    ],
  },
  cls_kansai_intermediate: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 9500,
    hourlyRateJpy: 1300,
    models: [
      { make: 'Toyota', model: 'Corolla' },
      { make: 'Subaru', model: 'Impreza' },
      { make: 'Mazda', model: 'Mazda3' },
    ],
  },
  cls_kansai_suv: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    dailyRateJpy: 11500,
    hourlyRateJpy: 1600,
    models: [
      { make: 'Toyota', model: 'RAV4' },
      { make: 'Suzuki', model: 'Jimny' },
      { make: 'Mazda', model: 'CX-5' },
    ],
  },
  cls_kansai_van: {
    seats: 7,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 16000,
    hourlyRateJpy: 2200,
    models: [
      { make: 'Toyota', model: 'Sienta' },
      { make: 'Honda', model: 'Freed' },
      { make: 'Toyota', model: 'Voxy' },
    ],
  },
  // Sakura Mobility
  cls_sakura_kei: {
    seats: 4,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    dailyRateJpy: 6500,
    hourlyRateJpy: 900,
    models: [
      { make: 'Honda', model: 'N-BOX' },
      { make: 'Daihatsu', model: 'Tanto' },
      { make: 'Suzuki', model: 'Spacia' },
    ],
  },
  cls_sakura_compact: {
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 8000,
    hourlyRateJpy: 1100,
    models: [
      { make: 'Toyota', model: 'Yaris' },
      { make: 'Suzuki', model: 'Swift' },
      { make: 'Mazda', model: 'Mazda2' },
    ],
  },
  cls_sakura_fullsuv: {
    seats: 7,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    dailyRateJpy: 15000,
    hourlyRateJpy: 2000,
    models: [
      { make: 'Toyota', model: 'Harrier' },
      { make: 'Toyota', model: 'Land Cruiser Prado' },
      { make: 'Mazda', model: 'CX-8' },
    ],
  },
  cls_sakura_premium_van: {
    seats: 8,
    transmission: 'AUTO',
    fuelType: 'Hybrid',
    dailyRateJpy: 17000,
    hourlyRateJpy: 2400,
    models: [
      { make: 'Toyota', model: 'Alphard' },
      { make: 'Toyota', model: 'Vellfire' },
      { make: 'Toyota', model: 'Granace' },
    ],
  },
}

/**
 * Real exterior photos per `${make} ${model}`, sourced from Wikimedia Commons
 * (file titles verified to name the model; URLs verified HTTP 200 image/jpeg).
 * Models repeat across the 41-vehicle fleet, so one keyed lookup covers every
 * instance. Any model absent here falls back to a labeled placeholder via
 * `photosForModel`, so storefront coverage is always total.
 *
 * NOTE: these hotlink Commons' thumb CDN — fine at demo scale, but for production
 * download + re-host in R2 (Commons discourages bulk hotlinking). See
 * docs/plans/2026-06-16-vehicle-photo-optimization.md.
 */
const MODEL_PHOTOS: Record<string, readonly string[]> = {
  'Daihatsu Tanto': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/2010-2013_Daihatsu_Tanto_Custom.jpg/960px-2010-2013_Daihatsu_Tanto_Custom.jpg',
  ],
  'Honda Fit': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/2013-2017_Honda_Fit_Hybrid_F_Package.jpg/960px-2013-2017_Honda_Fit_Hybrid_F_Package.jpg',
  ],
  'Honda Freed': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/2019_Honda_Freed%2B_%28ZDC%29_silver_front.jpg/960px-2019_Honda_Freed%2B_%28ZDC%29_silver_front.jpg',
  ],
  'Honda N-BOX': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/3rd_generation_Honda_N-BOX_Custom.jpg/960px-3rd_generation_Honda_N-BOX_Custom.jpg',
  ],
  'Honda Vezel': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/2013-2018_Honda_Vezel_Hybrid_X.jpg/960px-2013-2018_Honda_Vezel_Hybrid_X.jpg',
  ],
  'Mazda CX-5': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/2017_Mazda_CX-5_%28KF%29_Maxx_2WD_wagon_%282018-11-02%29_01.jpg/960px-2017_Mazda_CX-5_%28KF%29_Maxx_2WD_wagon_%282018-11-02%29_01.jpg',
  ],
  'Mazda CX-8': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/2024_Mazda_CX-8_2.5_Signature_in_Jet_Black%2C_front_right.jpg/960px-2024_Mazda_CX-8_2.5_Signature_in_Jet_Black%2C_front_right.jpg',
  ],
  'Mazda Mazda2': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/06-2024_Mazda2_E-Skyactiv-G.jpg/960px-06-2024_Mazda2_E-Skyactiv-G.jpg',
  ],
  'Mazda Mazda3': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Mazda3_Hatch_%28BP%29_Washington_DC_Metro_Area%2C_USA.jpg/960px-Mazda3_Hatch_%28BP%29_Washington_DC_Metro_Area%2C_USA.jpg',
  ],
  'Nissan Note': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/Nissan_Note_e-POWER_%28E13%29%2C_2021%2C_front.jpg/960px-Nissan_Note_e-POWER_%28E13%29%2C_2021%2C_front.jpg',
  ],
  'Nissan Skyline': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/2019_Nissan_Skyline_400R.jpg/960px-2019_Nissan_Skyline_400R.jpg',
  ],
  'Subaru Impreza': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/2021_Subaru_Impreza_Sedan%2C_front_left%2C_02-06-2023.jpg/960px-2021_Subaru_Impreza_Sedan%2C_front_left%2C_02-06-2023.jpg',
  ],
  'Suzuki Hustler': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/2024_Suzuki_Hustler_Hybrid_X.jpg/960px-2024_Suzuki_Hustler_Hybrid_X.jpg',
  ],
  'Suzuki Jimny': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/2018-2024_Suzuki_Jimny_Sierra_JC.jpg/960px-2018-2024_Suzuki_Jimny_Sierra_JC.jpg',
  ],
  'Suzuki Spacia': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/2017-2021_Suzuki_Spacia_Hybrid.jpg/960px-2017-2021_Suzuki_Spacia_Hybrid.jpg',
  ],
  'Suzuki Swift': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/2018_Suzuki_Swift_SZ5_Boosterjet_SHVS_1.0_Front.jpg/960px-2018_Suzuki_Swift_SZ5_Boosterjet_SHVS_1.0_Front.jpg',
  ],
  'Suzuki Wagon R': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/2017-2022_Suzuki_Wagon_R_Hybrid_FX.jpg/960px-2017-2022_Suzuki_Wagon_R_Hybrid_FX.jpg',
  ],
  'Toyota Alphard': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/2018-2023_Toyota_Alphard_X.jpg/960px-2018-2023_Toyota_Alphard_X.jpg',
  ],
  'Toyota Aqua': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/2025_Toyota_Aqua_Z.jpg/960px-2025_Toyota_Aqua_Z.jpg',
  ],
  'Toyota Camry': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/2018_Toyota_Camry_%28ASV70R%29_Ascent_sedan_%282018-08-27%29_01.jpg/960px-2018_Toyota_Camry_%28ASV70R%29_Ascent_sedan_%282018-08-27%29_01.jpg',
  ],
  'Toyota Corolla': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/2018_Toyota_Corolla_%28ZRE172R%29_Ascent_sedan_%282018-11-02%29_02.jpg/960px-2018_Toyota_Corolla_%28ZRE172R%29_Ascent_sedan_%282018-11-02%29_02.jpg',
  ],
  'Toyota Crown': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Toyota_CROWN_3.5HYBRID_RS_Advance_%286AA-GWS224-AEXAB%29_front_%28cropped%29.jpg/960px-Toyota_CROWN_3.5HYBRID_RS_Advance_%286AA-GWS224-AEXAB%29_front_%28cropped%29.jpg',
  ],
  'Toyota Granace': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Toyota_GRANACE_Premium_%283DA-GDH303W-RDTJY%29_front.jpg/960px-Toyota_GRANACE_Premium_%283DA-GDH303W-RDTJY%29_front.jpg',
  ],
  'Toyota Harrier': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/2015_Toyota_Harrier_Premium_2WD_2.0_DBA-ZSU60W_%28190316%29.jpg/960px-2015_Toyota_Harrier_Premium_2WD_2.0_DBA-ZSU60W_%28190316%29.jpg',
  ],
  'Toyota Land Cruiser Prado': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Toyota_Land_Cruiser_Prado%2C_Baku_%28P1090223%29.jpg/960px-Toyota_Land_Cruiser_Prado%2C_Baku_%28P1090223%29.jpg',
  ],
  'Toyota RAV4': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/2025_Toyota_RAV4_Hybrid_Z.jpg/960px-2025_Toyota_RAV4_Hybrid_Z.jpg',
  ],
  'Toyota Sienta': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/2016_Toyota_Sienta_1.5_V_NSP170R_%2820190622%29.jpg/960px-2016_Toyota_Sienta_1.5_V_NSP170R_%2820190622%29.jpg',
  ],
  'Toyota Vellfire': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/2018-2019_Toyota_Vellfire_Hybrid_X.jpg/960px-2018-2019_Toyota_Vellfire_Hybrid_X.jpg',
  ],
  'Toyota Voxy': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/2017-2019_Toyota_Voxy_ZS_Kirameki.jpg/960px-2017-2019_Toyota_Voxy_ZS_Kirameki.jpg',
  ],
  'Toyota Yaris': [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/2020-2024_Toyota_Yaris.jpg/960px-2020-2024_Toyota_Yaris.jpg',
  ],
}

/** Labeled placeholder backstop for any model absent from MODEL_PHOTOS. */
const placeholderPhoto = (make: string, model: string): string =>
  `https://placehold.co/960x640?text=${encodeURIComponent(`${make} ${model}`)}`

function photosForModel(make: string, model: string): readonly string[] {
  return MODEL_PHOTOS[`${make} ${model}`] ?? [placeholderPhoto(make, model)]
}

type Placement = {
  readonly id: string
  readonly classId: string
  readonly pickupLocationId: string
  readonly modelIdx: number
  readonly year: number
  readonly color: string
  readonly licensePlate: string
}

/**
 * One row per vehicle. Grouped by operator; within an operator, spread across its
 * 3 locations so each location carries >=3 distinct classes (headline §3.3).
 * Rental plates use the わ hiragana; the 4-digit block is globally unique.
 * Class totals: MCAR 7, ECAR 6, CCAR 6, ICAR 5, SCAR 4, IFAR 6, FFAR 3, PVAR 4 = 41.
 */
const PLACEMENTS: readonly Placement[] = [
  // --- Best Car Rental (Osaka) — Namba / Shin-Osaka / KIX ---
  {
    id: 'veh_best_kei_01',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_namba',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: 'なにわ 580 わ 10-01',
  },
  {
    id: 'veh_best_kei_02',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_namba',
    modelIdx: 1,
    year: 2022,
    color: 'Yellow',
    licensePlate: 'なにわ 580 わ 10-02',
  },
  {
    id: 'veh_best_kei_03',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_shin_osaka',
    modelIdx: 2,
    year: 2023,
    color: 'Pink',
    licensePlate: 'なにわ 580 わ 10-03',
  },
  {
    id: 'veh_best_kei_04',
    classId: 'cls_best_kei',
    pickupLocationId: 'loc_best_kix',
    modelIdx: 3,
    year: 2024,
    color: 'Silver',
    licensePlate: 'なにわ 580 わ 10-04',
  },
  {
    id: 'veh_best_compact_01',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_namba',
    modelIdx: 0,
    year: 2024,
    color: 'Red',
    licensePlate: 'なにわ 300 わ 20-01',
  },
  {
    id: 'veh_best_compact_02',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_shin_osaka',
    modelIdx: 1,
    year: 2023,
    color: 'Blue',
    licensePlate: 'なにわ 300 わ 20-02',
  },
  {
    id: 'veh_best_compact_03',
    classId: 'cls_best_compact',
    pickupLocationId: 'loc_best_kix',
    modelIdx: 2,
    year: 2022,
    color: 'White',
    licensePlate: 'なにわ 300 わ 20-03',
  },
  {
    id: 'veh_best_sedan_01',
    classId: 'cls_best_sedan',
    pickupLocationId: 'loc_best_namba',
    modelIdx: 0,
    year: 2024,
    color: 'Black',
    licensePlate: 'なにわ 300 わ 30-01',
  },
  {
    id: 'veh_best_sedan_02',
    classId: 'cls_best_sedan',
    pickupLocationId: 'loc_best_shin_osaka',
    modelIdx: 1,
    year: 2023,
    color: 'Black',
    licensePlate: 'なにわ 300 わ 30-02',
  },
  {
    id: 'veh_best_sedan_03',
    classId: 'cls_best_sedan',
    pickupLocationId: 'loc_best_shin_osaka',
    modelIdx: 2,
    year: 2022,
    color: 'Silver',
    licensePlate: 'なにわ 300 わ 30-03',
  },
  {
    id: 'veh_best_sedan_04',
    classId: 'cls_best_sedan',
    pickupLocationId: 'loc_best_kix',
    modelIdx: 0,
    year: 2024,
    color: 'White',
    licensePlate: 'なにわ 300 わ 30-04',
  },
  {
    id: 'veh_best_suv_01',
    classId: 'cls_best_suv',
    pickupLocationId: 'loc_best_namba',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: 'なにわ 300 わ 40-01',
  },
  {
    id: 'veh_best_suv_02',
    classId: 'cls_best_suv',
    pickupLocationId: 'loc_best_shin_osaka',
    modelIdx: 1,
    year: 2024,
    color: 'Red',
    licensePlate: 'なにわ 300 わ 40-02',
  },
  {
    id: 'veh_best_suv_03',
    classId: 'cls_best_suv',
    pickupLocationId: 'loc_best_kix',
    modelIdx: 2,
    year: 2023,
    color: 'Blue',
    licensePlate: 'なにわ 300 わ 40-03',
  },
  // --- Kansai Drive (Osaka / Kobe) — Umeda / Tennoji / Sannomiya ---
  {
    id: 'veh_kansai_econ_01',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 0,
    year: 2022,
    color: 'White',
    licensePlate: '大阪 300 わ 50-01',
  },
  {
    id: 'veh_kansai_econ_02',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 1,
    year: 2023,
    color: 'Silver',
    licensePlate: '大阪 300 わ 50-02',
  },
  {
    id: 'veh_kansai_econ_03',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_tennoji',
    modelIdx: 2,
    year: 2023,
    color: 'Blue',
    licensePlate: '大阪 300 わ 50-03',
  },
  {
    id: 'veh_kansai_econ_04',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_tennoji',
    modelIdx: 0,
    year: 2024,
    color: 'Red',
    licensePlate: '大阪 300 わ 50-04',
  },
  {
    id: 'veh_kansai_econ_05',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_sannomiya',
    modelIdx: 1,
    year: 2022,
    color: 'White',
    licensePlate: '神戸 300 わ 50-05',
  },
  {
    id: 'veh_kansai_econ_06',
    classId: 'cls_kansai_economy',
    pickupLocationId: 'loc_kansai_sannomiya',
    modelIdx: 0,
    year: 2023,
    color: 'Black',
    licensePlate: '神戸 300 わ 50-06',
  },
  {
    id: 'veh_kansai_inter_01',
    classId: 'cls_kansai_intermediate',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 0,
    year: 2023,
    color: 'Silver',
    licensePlate: '大阪 300 わ 60-01',
  },
  {
    id: 'veh_kansai_inter_02',
    classId: 'cls_kansai_intermediate',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 1,
    year: 2022,
    color: 'Blue',
    licensePlate: '大阪 300 わ 60-02',
  },
  {
    id: 'veh_kansai_inter_03',
    classId: 'cls_kansai_intermediate',
    pickupLocationId: 'loc_kansai_tennoji',
    modelIdx: 2,
    year: 2024,
    color: 'Red',
    licensePlate: '大阪 300 わ 60-03',
  },
  {
    id: 'veh_kansai_inter_04',
    classId: 'cls_kansai_intermediate',
    pickupLocationId: 'loc_kansai_tennoji',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: '大阪 300 わ 60-04',
  },
  {
    id: 'veh_kansai_inter_05',
    classId: 'cls_kansai_intermediate',
    pickupLocationId: 'loc_kansai_sannomiya',
    modelIdx: 1,
    year: 2023,
    color: 'Gray',
    licensePlate: '神戸 300 わ 60-05',
  },
  {
    id: 'veh_kansai_suv_01',
    classId: 'cls_kansai_suv',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: '大阪 300 わ 70-01',
  },
  {
    id: 'veh_kansai_suv_02',
    classId: 'cls_kansai_suv',
    pickupLocationId: 'loc_kansai_tennoji',
    modelIdx: 1,
    year: 2022,
    color: 'Green',
    licensePlate: '大阪 300 わ 70-02',
  },
  {
    id: 'veh_kansai_suv_03',
    classId: 'cls_kansai_suv',
    pickupLocationId: 'loc_kansai_sannomiya',
    modelIdx: 2,
    year: 2024,
    color: 'Red',
    licensePlate: '神戸 300 わ 70-03',
  },
  {
    id: 'veh_kansai_van_01',
    classId: 'cls_kansai_van',
    pickupLocationId: 'loc_kansai_umeda',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: '大阪 300 わ 80-01',
  },
  {
    id: 'veh_kansai_van_02',
    classId: 'cls_kansai_van',
    pickupLocationId: 'loc_kansai_sannomiya',
    modelIdx: 1,
    year: 2022,
    color: 'Silver',
    licensePlate: '神戸 300 わ 80-02',
  },
  // --- Sakura Mobility (Kyoto / Nara / Osaka) — Kyoto Station / Nara / Osaka Castle ---
  {
    id: 'veh_sakura_kei_01',
    classId: 'cls_sakura_kei',
    pickupLocationId: 'loc_sakura_kyoto',
    modelIdx: 0,
    year: 2023,
    color: 'White',
    licensePlate: '京都 580 わ 11-01',
  },
  {
    id: 'veh_sakura_kei_02',
    classId: 'cls_sakura_kei',
    pickupLocationId: 'loc_sakura_nara',
    modelIdx: 1,
    year: 2022,
    color: 'Beige',
    licensePlate: '奈良 580 わ 11-02',
  },
  {
    id: 'veh_sakura_kei_03',
    classId: 'cls_sakura_kei',
    pickupLocationId: 'loc_sakura_osaka_castle',
    modelIdx: 2,
    year: 2024,
    color: 'Silver',
    licensePlate: '大阪 580 わ 11-03',
  },
  {
    id: 'veh_sakura_compact_01',
    classId: 'cls_sakura_compact',
    pickupLocationId: 'loc_sakura_kyoto',
    modelIdx: 0,
    year: 2024,
    color: 'Red',
    licensePlate: '京都 300 わ 21-01',
  },
  {
    id: 'veh_sakura_compact_02',
    classId: 'cls_sakura_compact',
    pickupLocationId: 'loc_sakura_nara',
    modelIdx: 1,
    year: 2023,
    color: 'Blue',
    licensePlate: '奈良 300 わ 21-02',
  },
  {
    id: 'veh_sakura_compact_03',
    classId: 'cls_sakura_compact',
    pickupLocationId: 'loc_sakura_osaka_castle',
    modelIdx: 2,
    year: 2022,
    color: 'White',
    licensePlate: '大阪 300 わ 21-03',
  },
  {
    id: 'veh_sakura_fullsuv_01',
    classId: 'cls_sakura_fullsuv',
    pickupLocationId: 'loc_sakura_kyoto',
    modelIdx: 0,
    year: 2023,
    color: 'Black',
    licensePlate: '京都 300 わ 31-01',
  },
  {
    id: 'veh_sakura_fullsuv_02',
    classId: 'cls_sakura_fullsuv',
    pickupLocationId: 'loc_sakura_nara',
    modelIdx: 1,
    year: 2024,
    color: 'White',
    licensePlate: '奈良 300 わ 31-02',
  },
  {
    id: 'veh_sakura_fullsuv_03',
    classId: 'cls_sakura_fullsuv',
    pickupLocationId: 'loc_sakura_osaka_castle',
    modelIdx: 2,
    year: 2023,
    color: 'Gray',
    licensePlate: '大阪 300 わ 31-03',
  },
  {
    id: 'veh_sakura_pvan_01',
    classId: 'cls_sakura_premium_van',
    pickupLocationId: 'loc_sakura_kyoto',
    modelIdx: 0,
    year: 2024,
    color: 'Black',
    licensePlate: '京都 300 わ 41-01',
  },
  {
    id: 'veh_sakura_pvan_02',
    classId: 'cls_sakura_premium_van',
    pickupLocationId: 'loc_sakura_osaka_castle',
    modelIdx: 1,
    year: 2023,
    color: 'White',
    licensePlate: '大阪 300 わ 41-02',
  },
] as const

const operatorByClassId = new Map(DEMO_VEHICLE_CLASSES.map((c) => [c.id, c.operatorId]))

function expandPlacement(p: Placement): DemoVehicle {
  const operatorId = operatorByClassId.get(p.classId)
  const profile = CLASS_PROFILE[p.classId]
  if (operatorId === undefined || profile === undefined) {
    throw new Error(`DEMO_VEHICLES: unknown classId "${p.classId}" for ${p.id}`)
  }
  const spec = profile.models[p.modelIdx]
  if (spec === undefined) {
    throw new Error(`DEMO_VEHICLES: ${p.id} modelIdx ${p.modelIdx} out of range`)
  }
  return {
    id: p.id,
    operatorId,
    classId: p.classId,
    pickupLocationId: p.pickupLocationId,
    name: `${spec.make} ${spec.model}`,
    make: spec.make,
    model: spec.model,
    year: p.year,
    color: p.color,
    seats: profile.seats,
    transmission: profile.transmission,
    fuelType: profile.fuelType,
    licensePlate: p.licensePlate,
    dailyRateJpy: profile.dailyRateJpy,
    hourlyRateJpy: profile.hourlyRateJpy,
    photos: photosForModel(spec.make, spec.model),
  }
}

export const DEMO_VEHICLES: readonly DemoVehicle[] = PLACEMENTS.map(expandPlacement)
