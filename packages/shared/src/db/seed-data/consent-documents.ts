/**
 * MVP legal copy for the consent-ledger seed (#877). RENTER_LIABILITY text is
 * the verbatim booking i18n (`packages/web/messages/*.json` §disclaimer) so the
 * Phase 4 IMPORTED backfill matches byte-for-byte. RENTER_TOS / PRIVACY_POLICY
 * / OPERATOR_AGREEMENT bodies are concise MVP copy — replace with counsel-
 * reviewed text before production.
 */
import type { ConsentDocStatus, ConsentType } from '../../enums'
import { computeContentHash } from '../../lib/consent-canonical'

export interface DemoConsentDocument {
  id: string
  type: ConsentType
  version: string
  locale: string
  title: string
  body: string
  acceptanceLabel: string
  contentHash: string
  status: ConsentDocStatus
  effectiveFrom: Date
}

const EFFECTIVE_FROM = new Date('2026-06-13T00:00:00Z')

interface LocaleCopy {
  title: string
  body: string
  acceptanceLabel: string
}

interface Copy {
  version: string
  locales: Record<'en' | 'ja' | 'zh', LocaleCopy>
}

const COPY: Record<ConsentType, Copy> = {
  RENTER_LIABILITY: {
    version: '2026-06-13',
    locales: {
      en: {
        title: 'Rental Liability Disclaimer',
        // Verbatim from packages/web/messages/en.json §disclaimer.terms
        body: 'License and International Driving Permit verification is completed in person at pickup, not online. By reserving, you confirm you hold the required documents and accept full responsibility for the vehicle during your rental.',
        // Verbatim from packages/web/messages/en.json §disclaimer.label
        acceptanceLabel:
          "I agree to present a valid driver's license and International Driving Permit at pickup, and I accept the rental liability terms.",
      },
      ja: {
        title: 'レンタル責任に関する免責事項',
        // Verbatim from packages/web/messages/ja.json §disclaimer.terms
        body: '運転免許証と国際運転免許証の確認は、オンラインではなく受け取り時に対面で行います。ご予約により、必要書類を所持していることを確認し、レンタル期間中の車両に対する全責任を負うことに同意したものとみなされます。',
        // Verbatim from packages/web/messages/ja.json §disclaimer.label
        acceptanceLabel:
          '受け取り時に有効な運転免許証および国際運転免許証を提示し、レンタルの責任条件に同意します。',
      },
      zh: {
        title: '租赁责任免责声明',
        // Verbatim from packages/web/messages/zh.json §disclaimer.terms
        body: '驾驶证和国际驾驶许可证的核验将在取车时当面完成，而非在线办理。预订即表示您确认持有所需证件，并同意在租赁期间对车辆承担全部责任。',
        // Verbatim from packages/web/messages/zh.json §disclaimer.label
        acceptanceLabel: '我同意在取车时出示有效驾驶证和国际驾驶许可证，并接受租赁责任条款。',
      },
    },
  },
  RENTER_TOS: {
    version: '1.0',
    locales: {
      en: {
        title: 'Terms of Service',
        body: "These Terms govern your use of the Kuruma car-rental marketplace. You agree to provide accurate booking information, follow each operator's pickup and return rules, and use reserved vehicles lawfully. Bookings are instant-confirmed; cancellation fees apply on a tiered schedule disclosed at checkout.",
        acceptanceLabel: 'I have read and accept the Terms of Service.',
      },
      ja: {
        title: '利用規約',
        body: '本規約は、Kuruma カーレンタル・マーケットプレイスのご利用に適用されます。お客様は、正確な予約情報の提供、各事業者の受け渡しおよび返却規則の遵守、ならびに予約車両の適法な利用に同意するものとします。予約は即時確定され、キャンセル料は予約時に提示される段階的な料金体系に従います。',
        acceptanceLabel: '利用規約を読み、同意します。',
      },
      zh: {
        title: '服务条款',
        body: '本条款适用于您对 Kuruma 汽车租赁平台的使用。您同意提供准确的预订信息，遵守各运营商的取车与还车规则，并合法使用所预订的车辆。预订即时确认，取消费用按结账时披露的分级标准收取。',
        acceptanceLabel: '我已阅读并接受服务条款。',
      },
    },
  },
  PRIVACY_POLICY: {
    version: '1.0',
    locales: {
      en: {
        title: 'Privacy Policy',
        body: 'We collect the booking, contact, and identity-verification data needed to provide rentals, and share it with the operator fulfilling your booking. We retain consent and transaction records as legally required and never sell your personal data.',
        acceptanceLabel: 'I have read and accept the Privacy Policy.',
      },
      ja: {
        title: 'プライバシーポリシー',
        body: '当社は、レンタルの提供に必要な予約・連絡先・本人確認の情報を取得し、ご予約を履行する事業者と共有します。同意および取引の記録は法令で要求される期間保持し、お客様の個人データを販売することはありません。',
        acceptanceLabel: 'プライバシーポリシーを読み、同意します。',
      },
      zh: {
        title: '隐私政策',
        body: '我们收集提供租赁服务所需的预订、联系方式及身份核验信息，并与履行您预订的运营商共享。我们将按法律要求保留同意与交易记录，绝不出售您的个人数据。',
        acceptanceLabel: '我已阅读并接受隐私政策。',
      },
    },
  },
  OPERATOR_AGREEMENT: {
    version: '1.0',
    locales: {
      en: {
        title: 'Operator Platform Agreement',
        body: "As an operator you agree to list accurate vehicle and pricing information, honor instant-confirmed bookings, complete identity verification at pickup, and pay the platform commission disclosed in your operator console. You are responsible for your fleet's insurance and roadworthiness.",
        acceptanceLabel:
          'I am authorized to bind this operator and accept the Operator Platform Agreement.',
      },
      ja: {
        title: '事業者プラットフォーム規約',
        body: '事業者として、お客様は正確な車両および料金情報の掲載、即時確定予約の履行、受け渡し時の本人確認の実施、ならびに事業者コンソールに表示されるプラットフォーム手数料の支払いに同意します。車両の保険および整備状態については事業者が責任を負います。',
        acceptanceLabel:
          '私はこの事業者を代表する権限を有し、事業者プラットフォーム規約に同意します。',
      },
      zh: {
        title: '运营商平台协议',
        body: '作为运营商，您同意发布准确的车辆与价格信息、履行即时确认的预订、在取车时完成身份核验，并支付运营商控制台所披露的平台佣金。车队的保险与适驾状态由运营商负责。',
        acceptanceLabel: '我已获授权代表该运营商，并接受运营商平台协议。',
      },
    },
  },
}

function buildDocs(): readonly DemoConsentDocument[] {
  const rows: DemoConsentDocument[] = []
  for (const type of Object.keys(COPY) as ConsentType[]) {
    const { version, locales } = COPY[type]
    for (const locale of ['en', 'ja', 'zh'] as const) {
      const c = locales[locale]
      rows.push({
        id: `consent_${type.toLowerCase()}_${version.replace(/\./g, '_')}_${locale}`,
        type,
        version,
        locale,
        title: c.title,
        body: c.body,
        acceptanceLabel: c.acceptanceLabel,
        contentHash: computeContentHash(c),
        status: 'PUBLISHED',
        effectiveFrom: EFFECTIVE_FROM,
      })
    }
  }
  return rows
}

export const DEMO_CONSENT_DOCUMENTS: readonly DemoConsentDocument[] = buildDocs()
