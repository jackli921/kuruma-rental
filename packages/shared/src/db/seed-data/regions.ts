import type { regions } from '../schema'

/**
 * #394 hierarchical region taxonomy (prefecture -> city -> area), adjacency list.
 * Platform-global reference data — no operatorId. Demo seed scope is **Kansai
 * only**: every region node must own at least one seeded location, so we seed the
 * four prefectures that hold the 9 demo locations (Osaka, Kyoto, Hyogo, Nara) and
 * nothing else. Tokyo / others are appended when an operator with locations there
 * onboards (a region with no locations is a dead dropdown entry). See plan §3.
 *
 * Each `DEMO_LOCATIONS` row points its `regionId` at the deepest (area) node here.
 * `nameZh` uses simplified Chinese where it diverges from the Japanese kanji.
 */
export type DemoRegion = Pick<
  typeof regions.$inferInsert,
  'id' | 'parentId' | 'nameEn' | 'nameJa' | 'nameZh' | 'sortOrder'
> & {
  readonly id: string
  /** null = a root (prefecture); otherwise the parent region's id. */
  readonly parentId: string | null
  readonly nameEn: string
  readonly nameJa: string
  readonly nameZh: string
  readonly sortOrder: number
}

export const DEMO_REGIONS: readonly DemoRegion[] = [
  // ── Osaka 大阪府 ──────────────────────────────────────────────────────────
  {
    id: 'reg_osaka',
    parentId: null,
    nameEn: 'Osaka',
    nameJa: '大阪府',
    nameZh: '大阪府',
    sortOrder: 1,
  },
  {
    id: 'reg_osaka_city',
    parentId: 'reg_osaka',
    nameEn: 'Osaka City',
    nameJa: '大阪市',
    nameZh: '大阪市',
    sortOrder: 1,
  },
  {
    id: 'reg_namba',
    parentId: 'reg_osaka_city',
    nameEn: 'Namba',
    nameJa: '難波',
    nameZh: '难波',
    sortOrder: 1,
  },
  {
    id: 'reg_umeda',
    parentId: 'reg_osaka_city',
    nameEn: 'Umeda',
    nameJa: '梅田',
    nameZh: '梅田',
    sortOrder: 2,
  },
  {
    id: 'reg_tennoji',
    parentId: 'reg_osaka_city',
    nameEn: 'Tennoji',
    nameJa: '天王寺',
    nameZh: '天王寺',
    sortOrder: 3,
  },
  {
    id: 'reg_osaka_castle',
    parentId: 'reg_osaka_city',
    nameEn: 'Osaka Castle',
    nameJa: '大阪城',
    nameZh: '大阪城',
    sortOrder: 4,
  },
  {
    id: 'reg_shin_osaka',
    parentId: 'reg_osaka_city',
    nameEn: 'Shin-Osaka',
    nameJa: '新大阪',
    nameZh: '新大阪',
    sortOrder: 5,
  },
  {
    id: 'reg_izumisano',
    parentId: 'reg_osaka',
    nameEn: 'Izumisano',
    nameJa: '泉佐野市',
    nameZh: '泉佐野市',
    sortOrder: 2,
  },
  {
    id: 'reg_kix',
    parentId: 'reg_izumisano',
    nameEn: 'Kansai Airport (KIX)',
    nameJa: '関西空港',
    nameZh: '关西机场',
    sortOrder: 1,
  },
  // ── Kyoto 京都府 ──────────────────────────────────────────────────────────
  {
    id: 'reg_kyoto',
    parentId: null,
    nameEn: 'Kyoto',
    nameJa: '京都府',
    nameZh: '京都府',
    sortOrder: 2,
  },
  {
    id: 'reg_kyoto_city',
    parentId: 'reg_kyoto',
    nameEn: 'Kyoto City',
    nameJa: '京都市',
    nameZh: '京都市',
    sortOrder: 1,
  },
  {
    id: 'reg_kyoto_station',
    parentId: 'reg_kyoto_city',
    nameEn: 'Kyoto Station',
    nameJa: '京都駅',
    nameZh: '京都站',
    sortOrder: 1,
  },
  // ── Hyogo 兵庫県 ──────────────────────────────────────────────────────────
  {
    id: 'reg_hyogo',
    parentId: null,
    nameEn: 'Hyogo',
    nameJa: '兵庫県',
    nameZh: '兵库县',
    sortOrder: 3,
  },
  {
    id: 'reg_kobe_city',
    parentId: 'reg_hyogo',
    nameEn: 'Kobe City',
    nameJa: '神戸市',
    nameZh: '神户市',
    sortOrder: 1,
  },
  {
    id: 'reg_sannomiya',
    parentId: 'reg_kobe_city',
    nameEn: 'Sannomiya',
    nameJa: '三宮',
    nameZh: '三宫',
    sortOrder: 1,
  },
  // ── Nara 奈良県 ───────────────────────────────────────────────────────────
  {
    id: 'reg_nara',
    parentId: null,
    nameEn: 'Nara',
    nameJa: '奈良県',
    nameZh: '奈良县',
    sortOrder: 4,
  },
  {
    id: 'reg_nara_city',
    parentId: 'reg_nara',
    nameEn: 'Nara City',
    nameJa: '奈良市',
    nameZh: '奈良市',
    sortOrder: 1,
  },
  {
    id: 'reg_nara_area',
    parentId: 'reg_nara_city',
    nameEn: 'Nara',
    nameJa: '奈良',
    nameZh: '奈良',
    sortOrder: 1,
  },
] as const
