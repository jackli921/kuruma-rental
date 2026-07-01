import type { RegionType } from '../../enums'
import type { regions } from '../schema'
import { EAST_JAPAN_REGIONS } from './regions-east'
import { WEST_JAPAN_REGIONS } from './regions-west'

/**
 * #394 hierarchical region taxonomy (prefecture -> city -> area), adjacency list.
 * Platform-global reference data — no operatorId.
 *
 * #1276 — **nationwide** scope: all 47 prefectures (JIS X 0401 order), each
 * prefecture's capital city, and the 5 non-capital government-designated cities
 * (Kawasaki, Sagamihara, Hamamatsu, Sakai, Kitakyushu — the other 15 designated
 * cities ARE their prefecture's capital, seeded once as the capital). The Kansai
 * demo core (Osaka/Kyoto/Hyogo/Nara + their 9 AREA nodes) is kept verbatim; every
 * CITY node is now `assignable` so an operator can pick prefecture -> city and stop
 * there. Extending to the full ~1700 municipalities later is pure additive seed
 * data (no schema/UI change).
 *
 * Each `DEMO_LOCATIONS` row points its `regionId` at a deepest assignable node
 * here. `nameZh` uses simplified Chinese where it diverges from the Japanese kanji.
 *
 * #651 Slice 1 — every node carries a taxonomy `type`, a URL-stable `slug`, and
 * (on AREA nodes only) the area's WGS84 centre = its anchor location's coords, so
 * `nearestAssignableRegion` can match a pickup point. CITY + AREA nodes are
 * `assignable`; prefectures stay navigation-only. Cities carry null coords so they
 * are explicit-select-only (a null-coord node is skipped by `nearestAssignableRegion`,
 * keeping "near me" auto-derivation on the fine-grained AREA nodes as before).
 */
export type DemoRegion = Pick<
  typeof regions.$inferInsert,
  | 'id'
  | 'parentId'
  | 'nameEn'
  | 'nameJa'
  | 'nameZh'
  | 'sortOrder'
  | 'type'
  | 'latitude'
  | 'longitude'
  | 'assignable'
  | 'slug'
> & {
  readonly id: string
  /** null = a root (prefecture); otherwise the parent region's id. */
  readonly parentId: string | null
  readonly nameEn: string
  readonly nameJa: string
  readonly nameZh: string
  readonly sortOrder: number
  readonly type: RegionType
  /** Set on AREA nodes (= anchor location centre); null on prefectures/cities. */
  readonly latitude: number | null
  readonly longitude: number | null
  /** Only AREA nodes accept location assignment. */
  readonly assignable: boolean
  /** Unique, kebab-case URL handle for renter chips/deep links (?region=namba). */
  readonly slug: string
}

// Kansai demo core (#394/#651): the 4 original prefectures, their cities, and the
// 9 AREA nodes anchoring the demo locations. Sakai (a designated city) lives here
// too so it follows its reg_osaka parent. Nationwide rows are in regions-east/west.
const KANSAI_REGIONS: readonly DemoRegion[] = [
  // ── Osaka 大阪府 ──────────────────────────────────────────────────────────
  {
    id: 'reg_osaka',
    parentId: null,
    nameEn: 'Osaka',
    nameJa: '大阪府',
    nameZh: '大阪府',
    sortOrder: 1,
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: false,
    slug: 'osaka',
  },
  {
    id: 'reg_osaka_city',
    parentId: 'reg_osaka',
    nameEn: 'Osaka City',
    nameJa: '大阪市',
    nameZh: '大阪市',
    sortOrder: 1,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'osaka-city',
  },
  {
    id: 'reg_namba',
    parentId: 'reg_osaka_city',
    nameEn: 'Namba',
    nameJa: '難波',
    nameZh: '难波',
    sortOrder: 1,
    type: 'AREA',
    latitude: 34.6627,
    longitude: 135.5012,
    assignable: true,
    slug: 'namba',
  },
  {
    id: 'reg_umeda',
    parentId: 'reg_osaka_city',
    nameEn: 'Umeda',
    nameJa: '梅田',
    nameZh: '梅田',
    sortOrder: 2,
    type: 'AREA',
    latitude: 34.7025,
    longitude: 135.4959,
    assignable: true,
    slug: 'umeda',
  },
  {
    id: 'reg_tennoji',
    parentId: 'reg_osaka_city',
    nameEn: 'Tennoji',
    nameJa: '天王寺',
    nameZh: '天王寺',
    sortOrder: 3,
    type: 'AREA',
    latitude: 34.6463,
    longitude: 135.5135,
    assignable: true,
    slug: 'tennoji',
  },
  {
    id: 'reg_osaka_castle',
    parentId: 'reg_osaka_city',
    nameEn: 'Osaka Castle',
    nameJa: '大阪城',
    nameZh: '大阪城',
    sortOrder: 4,
    type: 'AREA',
    latitude: 34.6873,
    longitude: 135.5259,
    assignable: true,
    slug: 'osaka-castle',
  },
  {
    id: 'reg_shin_osaka',
    parentId: 'reg_osaka_city',
    nameEn: 'Shin-Osaka',
    nameJa: '新大阪',
    nameZh: '新大阪',
    sortOrder: 5,
    type: 'AREA',
    latitude: 34.7338,
    longitude: 135.5003,
    assignable: true,
    slug: 'shin-osaka',
  },
  {
    id: 'reg_izumisano',
    parentId: 'reg_osaka',
    nameEn: 'Izumisano',
    nameJa: '泉佐野市',
    nameZh: '泉佐野市',
    sortOrder: 2,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'izumisano',
  },
  {
    id: 'reg_kix',
    parentId: 'reg_izumisano',
    nameEn: 'Kansai Airport (KIX)',
    nameJa: '関西空港',
    nameZh: '关西机场',
    sortOrder: 1,
    type: 'AREA',
    latitude: 34.4347,
    longitude: 135.2441,
    assignable: true,
    slug: 'kix',
  },
  {
    // Government-designated city (non-capital) under Osaka.
    id: 'reg_sakai_city',
    parentId: 'reg_osaka',
    nameEn: 'Sakai',
    nameJa: '堺市',
    nameZh: '堺市',
    sortOrder: 3,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'sakai-city',
  },
  // ── Kyoto 京都府 ──────────────────────────────────────────────────────────
  {
    id: 'reg_kyoto',
    parentId: null,
    nameEn: 'Kyoto',
    nameJa: '京都府',
    nameZh: '京都府',
    sortOrder: 2,
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: false,
    slug: 'kyoto',
  },
  {
    id: 'reg_kyoto_city',
    parentId: 'reg_kyoto',
    nameEn: 'Kyoto City',
    nameJa: '京都市',
    nameZh: '京都市',
    sortOrder: 1,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'kyoto-city',
  },
  {
    id: 'reg_kyoto_station',
    parentId: 'reg_kyoto_city',
    nameEn: 'Kyoto Station',
    nameJa: '京都駅',
    nameZh: '京都站',
    sortOrder: 1,
    type: 'AREA',
    latitude: 34.9858,
    longitude: 135.7588,
    assignable: true,
    slug: 'kyoto-station',
  },
  // ── Hyogo 兵庫県 ──────────────────────────────────────────────────────────
  {
    id: 'reg_hyogo',
    parentId: null,
    nameEn: 'Hyogo',
    nameJa: '兵庫県',
    nameZh: '兵库县',
    sortOrder: 3,
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: false,
    slug: 'hyogo',
  },
  {
    id: 'reg_kobe_city',
    parentId: 'reg_hyogo',
    nameEn: 'Kobe City',
    nameJa: '神戸市',
    nameZh: '神户市',
    sortOrder: 1,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'kobe-city',
  },
  {
    id: 'reg_sannomiya',
    parentId: 'reg_kobe_city',
    nameEn: 'Sannomiya',
    nameJa: '三宮',
    nameZh: '三宫',
    sortOrder: 1,
    type: 'AREA',
    latitude: 34.6946,
    longitude: 135.1956,
    assignable: true,
    slug: 'sannomiya',
  },
  // ── Nara 奈良県 ───────────────────────────────────────────────────────────
  {
    id: 'reg_nara',
    parentId: null,
    nameEn: 'Nara',
    nameJa: '奈良県',
    nameZh: '奈良县',
    sortOrder: 4,
    type: 'PREFECTURE',
    latitude: null,
    longitude: null,
    assignable: false,
    slug: 'nara',
  },
  {
    id: 'reg_nara_city',
    parentId: 'reg_nara',
    nameEn: 'Nara City',
    nameJa: '奈良市',
    nameZh: '奈良市',
    sortOrder: 1,
    type: 'CITY',
    latitude: null,
    longitude: null,
    assignable: true,
    slug: 'nara-city',
  },
  {
    id: 'reg_nara_area',
    parentId: 'reg_nara_city',
    nameEn: 'Nara',
    nameJa: '奈良',
    nameZh: '奈良',
    sortOrder: 1,
    type: 'AREA',
    latitude: 34.6803,
    longitude: 135.8174,
    assignable: true,
    slug: 'nara-area',
  },
] as const

/**
 * The full seeded taxonomy: the Kansai demo core first (so reg_osaka precedes its
 * Sakai child), then the rest of Japan east-to-west. Order matters — seed.ts inserts
 * in array order and the self-referential parentId FK must resolve on insert.
 */
export const DEMO_REGIONS: readonly DemoRegion[] = [
  ...KANSAI_REGIONS,
  ...EAST_JAPAN_REGIONS,
  ...WEST_JAPAN_REGIONS,
]
