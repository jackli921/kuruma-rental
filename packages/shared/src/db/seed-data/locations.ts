import type { locations } from '../schema'

/**
 * Slice 8 demo locations (#390, §3.2). Three real Kansai pickup points per
 * operator (9 total) so the storefront map and per-location turnaround read as
 * credible. Turnaround VARIES per location (#551): central stores turn cars in
 * 60-180m, the airport in 24h, and only Osaka Castle keeps the 48h max — so a
 * single booking no longer cools a whole storefront for ~5 days. All values sit
 * at or above the 60m floor (locations_turnaround_min_60). Names are unique within
 * an operator (locations_operatorId_name_unique) but may repeat across operators.
 */
export type DemoLocation = Pick<
  typeof locations.$inferInsert,
  | 'id'
  | 'operatorId'
  | 'name'
  | 'address'
  | 'defaultTurnaroundMinutes'
  | 'timezone'
  | 'latitude'
  | 'longitude'
> & {
  readonly id: string
  readonly operatorId: string
  readonly name: string
  readonly address: string
  readonly defaultTurnaroundMinutes: number
  readonly timezone: string
  // WGS84 decimal degrees (#458 D2). Block-accurate — enough for storefront
  // pins; refine if needed. Real coords so the search map demos with real pins.
  readonly latitude: number
  readonly longitude: number
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
    latitude: 34.6627,
    longitude: 135.5012,
    // Busy central branch — quick same-day turnaround.
    defaultTurnaroundMinutes: 60,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_best_shin_osaka',
    operatorId: 'op_best_car_rental',
    name: 'Shin-Osaka',
    address: '5-16-1 Nishinakajima, Yodogawa-ku, Osaka 532-0011',
    latitude: 34.7338,
    longitude: 135.5003,
    defaultTurnaroundMinutes: 90,
    timezone: TIMEZONE,
  },
  {
    // Airport branch turns cars faster — demo of per-location turnaround override.
    id: 'loc_best_kix',
    operatorId: 'op_best_car_rental',
    name: 'Kansai Airport (KIX)',
    address: '1 Senshukukokita, Izumisano, Osaka 549-0001',
    latitude: 34.4347,
    longitude: 135.2441,
    defaultTurnaroundMinutes: 1440,
    timezone: TIMEZONE,
  },
  // Kansai Drive — Osaka/Kobe
  {
    id: 'loc_kansai_umeda',
    operatorId: 'op_kansai_drive',
    name: 'Umeda',
    address: '3-1-1 Umeda, Kita-ku, Osaka 530-0001',
    latitude: 34.7025,
    longitude: 135.4959,
    defaultTurnaroundMinutes: 120,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_kansai_tennoji',
    operatorId: 'op_kansai_drive',
    name: 'Tennoji',
    address: '10-48 Hidenin-cho, Tennoji-ku, Osaka 543-0055',
    latitude: 34.6463,
    longitude: 135.5135,
    defaultTurnaroundMinutes: 90,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_kansai_sannomiya',
    operatorId: 'op_kansai_drive',
    name: 'Kobe Sannomiya',
    address: '1-8-1 Kumoidori, Chuo-ku, Kobe 651-0096',
    latitude: 34.6946,
    longitude: 135.1956,
    defaultTurnaroundMinutes: 180,
    timezone: TIMEZONE,
  },
  // Sakura Mobility — Kyoto/Nara + Osaka Castle
  {
    id: 'loc_sakura_kyoto',
    operatorId: 'op_sakura_mobility',
    name: 'Kyoto Station',
    address: 'Higashishiokoji-cho, Shimogyo-ku, Kyoto 600-8216',
    latitude: 34.9858,
    longitude: 135.7588,
    defaultTurnaroundMinutes: 120,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_sakura_nara',
    operatorId: 'op_sakura_mobility',
    name: 'Nara',
    address: '1-1 Sanjohoncho, Nara 630-8122',
    latitude: 34.6803,
    longitude: 135.8174,
    defaultTurnaroundMinutes: 180,
    timezone: TIMEZONE,
  },
  {
    id: 'loc_sakura_osaka_castle',
    operatorId: 'op_sakura_mobility',
    name: 'Osaka Castle',
    address: '1-1 Osakajo, Chuo-ku, Osaka 540-0002',
    latitude: 34.6873,
    longitude: 135.5259,
    defaultTurnaroundMinutes: DEFAULT_TURNAROUND_MINUTES,
    timezone: TIMEZONE,
  },
] as const
