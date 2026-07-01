import type { LocalizedText } from '../../i18n/localized-text'
import type { addOnTemplates } from '../add-on'

/**
 * Curated, pre-translated add-on TEMPLATES (catalog i18n, slice 1). One template
 * per DISTINCT English add-on name in DEMO_ADD_ON_OPTIONS: an operator picks a
 * template and the renter reads its localized name/description in en/ja/zh
 * instead of the operator's raw English string.
 *
 * `key` is the stable join handle and MUST equal slugify(name.en) — the slice-2
 * backfill matches an operator's legacy add-on name to a template by this key
 * (invariant asserted in add-on-templates.test.ts). `name.en` therefore mirrors
 * the canonical English name in DEMO_ADD_ON_OPTIONS exactly.
 *
 * status defaults ACTIVE (omitted here); the row id is derived seedId('tmpl_' +
 * key) in seed.ts. Every bundle MUST carry ALL SUPPORTED_LOCALES — that is THE
 * guard, since localizedTextSchema only requires `en`, so a missing `zh` would
 * silently fall back to English at read time.
 */
export type DemoAddOnTemplate = Pick<
  typeof addOnTemplates.$inferInsert,
  'key' | 'name' | 'description'
> & {
  readonly key: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

export const DEMO_ADD_ON_TEMPLATES: readonly DemoAddOnTemplate[] = [
  {
    key: 'child_seat',
    name: { en: 'Child seat', ja: 'チャイルドシート', zh: '儿童座椅' },
    description: {
      en: 'Rear-facing or booster seat, fitted at pickup.',
      ja: '後ろ向きまたはブースターシート。受け取り時に取り付けます。',
      zh: '后向式或增高座椅，取车时安装。',
    },
  },
  {
    key: 'etc_card',
    name: { en: 'ETC card', ja: 'ETCカード', zh: 'ETC 卡' },
    description: {
      en: 'Expressway toll card — pay tolls automatically, settle on return.',
      ja: '高速道路料金カード。通行料を自動精算し、返却時にお支払いいただきます。',
      zh: '高速公路收费卡，自动缴纳过路费，还车时结算。',
    },
  },
  {
    key: 'additional_driver',
    name: { en: 'Additional driver', ja: '追加ドライバー', zh: '附加驾驶员' },
    description: {
      en: 'Register a second named driver on the rental agreement.',
      ja: 'レンタル契約に2人目の運転者を登録します。',
      zh: '在租赁协议上登记第二位指定驾驶员。',
    },
  },
  {
    key: 'pocket_wi_fi',
    name: { en: 'Pocket Wi-Fi', ja: 'ポケットWi-Fi', zh: '随身 Wi-Fi' },
    description: {
      en: 'Unlimited 4G pocket router for the trip.',
      ja: '旅行中に使える無制限4Gポケットルーター。',
      zh: '旅途中可用的无限流量 4G 随身路由器。',
    },
  },
  {
    key: 'snow_tires',
    name: { en: 'Snow tires', ja: 'スノータイヤ', zh: '雪地轮胎' },
    description: {
      en: 'Studless winter tires for mountain and snow-country routes.',
      ja: '山道や雪国のルート向けのスタッドレスタイヤ。',
      zh: '适合山路和雪国路线的无钉防滑冬季轮胎。',
    },
  },
  {
    key: 'english_gps_navigation',
    name: { en: 'English GPS navigation', ja: '英語カーナビ', zh: '英语 GPS 导航' },
    description: {
      en: 'Dashboard navigation unit with an English voice + map.',
      ja: '英語の音声と地図に対応したダッシュボードナビ。',
      zh: '配备英语语音和地图的车载导航仪。',
    },
  },
] as const
