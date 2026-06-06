import type { locations } from '../schema'

/**
 * Slice 8 demo locations (#390, §3.2). Three real Kansai pickup points per
 * operator (9 total) so the storefront map and per-location turnaround read as
 * credible. Turnaround defaults to 48h (2880m); Kansai Airport (KIX) overrides
 * to 24h to demo per-location configurability (§3.2). Names are unique within
 * an operator (locations_operatorId_name_unique) but may repeat across operators.
 */
export type DemoLocation = Pick<
  typeof locations.$inferInsert,
  'id' | 'operatorId' | 'name' | 'address' | 'defaultTurnaroundMinutes' | 'timezone'
> & {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly address: string
  readonly defaultTurnaroundMinutes: number
  readonly timezone: string
}

const DEFAULT_TURNAROUND_MINUTES = 2880
const TIMEZONE = 'Asia/Tokyo'

export const DEMO_LOCATIONS: readonly DemoLocation[] = [
  // Best Car Rental — central Osaka + airport
  {
    id: 'loc_best_namba',
    operatorId: 'op_best_car_rental',
    name: 'Namba',
    address: '2-10-70 Nanba, Chuo-ku, Osaka 542-0076',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_best_shin_osaka',
    operatorId: 'op_best_car_rental',
    name: 'Shin-Osaka',
    address: '5-16-1 Nishinakajima, Yodogawa-ku, Osaka 532-0011',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    // Airport branch turns cars faster — demo of per-location turnaround override.
    id: 'loc_best_kix',
    operatorId: 'op_best_car_rental',
    name: 'Kansai Airport (KIX)',
    address: '1 Senshukukokita, Izumisano, Osaka 549-0001',
    defaultTurnaroundMinutes: 1440,
    timezone: TIMEZONE,
  },
  // Kansai Drive — Osaka/Kobe
  {
    id: 'loc_kansai_umeda',
    operatorId: 'op_kansai_drive',
    name: 'Umeda',
    address: '3-1-1 Umeda, Kita-ku, Osaka 530-0001',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_kansai_tennoji',
    operatorId: 'op_kansai_drive',
    name: 'Tennoji',
    address: '10-48 Hidenin-cho, Tennoji-ku, Osaka 543-0055',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_kansai_sannomiya',
    operatorId: 'op_kansai_drive',
    name: 'Kobe Sannomiya',
    address: '1-8-1 Kumoidori, Chuo-ku, Kobe 651-0096',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  // Sakura Mobility — Kyoto/Nara + Osaka Castle
  {
    id: 'loc_sakura_kyoto',
    operatorId: 'op_sakura_mobility',
    name: 'Kyoto Station',
    address: 'Higashishiokoji-cho, Shimogyo-ku, Kyoto 600-8216',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_sakura_nara',
    operatorId: 'op_sakura_mobility',
    name: 'Nara',
    address: '1-1 Sanjohoncho, Nara 630-8122',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_sakura_osaka_castle',
    operatorId: 'op_sakura_mobility',
    name: 'Osaka Castle',
    address: '1-1 Osakajo, Chuo-ku, Osaka 540-0002',
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
] as const
