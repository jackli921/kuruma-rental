import type { BookingSource, FeeType } from '@kuruma/shared/db/schema'
import type { ComplianceAlertBand, ComplianceDocumentType } from '@kuruma/shared/lib/compliance'

// Outbound email i18n. Distinct from the web `next-intl` namespaces (these render
// in the API), so adding a key here needs no dev-server restart. Keep all three
// locales in lock-step — a missing key is a type error, not a silent fallback.
export type EmailLocale = 'en' | 'ja' | 'zh'

export interface EmailStrings {
  // Renter confirmation
  renterSubject: string // booking code appended by the renderer
  renterGreeting: string
  bookingCodeLabel: string
  operatorLabel: string
  vehicleLabel: string
  pickupLabel: string
  dropoffLabel: string
  periodLabel: string
  insuranceLabel: string
  insuranceDeclined: string
  totalLabel: string
  preAuthTitle: string
  preAuthExplain: string
  preAuthCta: string // MUST NOT contain the word "handoff" (test seal)
  potentialChargesTitle: string
  cancellationContact: string
  // Operator alert
  operatorSubject: string
  operatorHeading: string
  renterLabel: string
  // #960 operator-alert enrichment: contact, duration units, source, add-ons, deep link
  contactLabel: string
  sourceLabel: string
  addOnsLabel: string
  manageBookingTitle: string
  manageBookingCta: string
  dayUnit: string
  hourUnit: string
  sourceNames: Record<BookingSource, string>
  // #664 renter lifecycle pushes
  substitutionSubject: string // booking code appended
  substitutionHeading: string
  newVehicleLabel: string
  cancellationSubject: string
  cancellationHeading: string
  cancellationFeeLabel: string
  tripStartedSubject: string
  tripStartedHeading: string
  tripCompletedSubject: string
  tripCompletedHeading: string
  // Fee-type display names
  feeLabels: Record<FeeType, string>
  // #916 §5.4 compliance digest (operator-facing fleet reminder)
  complianceSubject: string // item count appended by the renderer
  complianceHeading: string
  complianceDocLabels: Record<ComplianceDocumentType, string>
  complianceBandLabels: Record<ComplianceAlertBand, string>
}

const en: EmailStrings = {
  renterSubject: 'Booking confirmed —',
  renterGreeting: 'Your booking is confirmed. Here are the details:',
  bookingCodeLabel: 'Booking code',
  operatorLabel: 'Operator',
  vehicleLabel: 'Vehicle',
  pickupLabel: 'Pick-up',
  dropoffLabel: 'Drop-off',
  periodLabel: 'Rental period',
  insuranceLabel: 'Insurance',
  insuranceDeclined: 'No insurance selected',
  totalLabel: 'Total',
  preAuthTitle: 'Pre-authorization required before pick-up',
  preAuthExplain:
    'Before collecting the car you must complete a security pre-authorization on the operator’s secure page. This holds (not charges) a refundable amount on your card.',
  preAuthCta: 'Complete pre-authorization',
  potentialChargesTitle: 'Potential additional charges',
  cancellationContact: 'To change or cancel, reply to this email.',
  operatorSubject: 'New booking —',
  operatorHeading: 'A new booking has landed:',
  renterLabel: 'Renter',
  contactLabel: 'Contact',
  sourceLabel: 'Source',
  addOnsLabel: 'Add-ons',
  manageBookingTitle: 'Manage this booking',
  manageBookingCta: 'Open booking in your dashboard',
  dayUnit: 'd',
  hourUnit: 'h',
  sourceNames: { DIRECT: 'Direct', TRIP_COM: 'Trip.com', MANUAL: 'Manual', OTHER: 'Other' },
  substitutionSubject: 'Vehicle changed —',
  substitutionHeading: 'The vehicle assigned to your booking has changed. Your new vehicle:',
  newVehicleLabel: 'New vehicle',
  cancellationSubject: 'Booking cancelled —',
  cancellationHeading: 'Your booking has been cancelled.',
  cancellationFeeLabel: 'Cancellation fee',
  tripStartedSubject: 'Trip started —',
  tripStartedHeading: 'Your rental has started. Enjoy the drive!',
  tripCompletedSubject: 'Trip completed —',
  tripCompletedHeading: 'Your rental is complete. Thank you for choosing us!',
  feeLabels: {
    OVERTIME_HOURLY: 'Overtime (per hour)',
    CLEANING_FLAT: 'Cleaning',
    NO_FUEL_FLAT: 'Refueling',
  },
  complianceSubject: 'Fleet compliance —',
  complianceHeading: 'The following vehicle documents need attention:',
  complianceDocLabels: { SHAKEN: 'Shaken (inspection)', INSURANCE: 'Insurance' },
  complianceBandLabels: {
    MISSING: 'No certificate on file',
    EXPIRED: 'Expired',
    D30: 'Expires in 30 days',
    D14: 'Expires in 14 days',
    D7: 'Expires in 7 days',
    D1: 'Expires within 1 day',
  },
}

const ja: EmailStrings = {
  renterSubject: 'ご予約確認 —',
  renterGreeting: 'ご予約が確定しました。詳細は以下のとおりです:',
  bookingCodeLabel: '予約番号',
  operatorLabel: '事業者',
  vehicleLabel: '車両',
  pickupLabel: '受取',
  dropoffLabel: '返却',
  periodLabel: 'レンタル期間',
  insuranceLabel: '保険',
  insuranceDeclined: '保険なし',
  totalLabel: '合計',
  preAuthTitle: 'お受け取り前に事前承認が必要です',
  preAuthExplain:
    '車をお受け取りになる前に、事業者の安全なページで保証金の事前承認を完了してください。これはカードに返金可能な金額を保留するもので、請求ではありません。',
  preAuthCta: '事前承認を完了する',
  potentialChargesTitle: '追加料金の可能性',
  cancellationContact: '変更・キャンセルはこのメールにご返信ください。',
  operatorSubject: '新規予約 —',
  operatorHeading: '新しい予約が入りました:',
  renterLabel: '利用者',
  contactLabel: '連絡先',
  sourceLabel: '予約元',
  addOnsLabel: 'オプション',
  manageBookingTitle: '予約の管理',
  manageBookingCta: 'ダッシュボードで予約を開く',
  dayUnit: '日',
  hourUnit: '時間',
  sourceNames: { DIRECT: '直接', TRIP_COM: 'Trip.com', MANUAL: '手動', OTHER: 'その他' },
  substitutionSubject: '車両変更のお知らせ —',
  substitutionHeading: 'ご予約の車両が変更されました。新しい車両は以下のとおりです:',
  newVehicleLabel: '新しい車両',
  cancellationSubject: 'ご予約キャンセルのお知らせ —',
  cancellationHeading: 'ご予約がキャンセルされました。',
  cancellationFeeLabel: 'キャンセル料',
  tripStartedSubject: 'レンタル開始のお知らせ —',
  tripStartedHeading: 'レンタルが開始されました。よい旅を!',
  tripCompletedSubject: 'レンタル完了のお知らせ —',
  tripCompletedHeading: 'レンタルが完了しました。ご利用ありがとうございました!',
  feeLabels: {
    OVERTIME_HOURLY: '延長料金（1時間あたり）',
    CLEANING_FLAT: 'クリーニング',
    NO_FUEL_FLAT: '給油',
  },
  complianceSubject: '車両コンプライアンス —',
  complianceHeading: '以下の車両書類の対応が必要です:',
  complianceDocLabels: { SHAKEN: '車検', INSURANCE: '保険' },
  complianceBandLabels: {
    MISSING: '証明書未登録',
    EXPIRED: '期限切れ',
    D30: 'あと30日で期限切れ',
    D14: 'あと14日で期限切れ',
    D7: 'あと7日で期限切れ',
    D1: '1日以内に期限切れ',
  },
}

const zh: EmailStrings = {
  renterSubject: '预订确认 —',
  renterGreeting: '您的预订已确认。详情如下:',
  bookingCodeLabel: '预订编号',
  operatorLabel: '运营商',
  vehicleLabel: '车辆',
  pickupLabel: '取车',
  dropoffLabel: '还车',
  periodLabel: '租赁期间',
  insuranceLabel: '保险',
  insuranceDeclined: '未选择保险',
  totalLabel: '合计',
  preAuthTitle: '取车前需要完成预授权',
  preAuthExplain:
    '取车前，请在运营商的安全页面完成押金预授权。这只会在您的卡上冻结一笔可退还的金额,而非实际扣款。',
  preAuthCta: '完成预授权',
  potentialChargesTitle: '可能产生的额外费用',
  cancellationContact: '如需更改或取消,请直接回复此邮件。',
  operatorSubject: '新预订 —',
  operatorHeading: '收到一笔新预订:',
  renterLabel: '租客',
  contactLabel: '联系方式',
  sourceLabel: '预订来源',
  addOnsLabel: '附加项目',
  manageBookingTitle: '管理此预订',
  manageBookingCta: '在仪表板中打开预订',
  dayUnit: '天',
  hourUnit: '小时',
  sourceNames: { DIRECT: '直接', TRIP_COM: 'Trip.com', MANUAL: '手动', OTHER: '其他' },
  substitutionSubject: '车辆变更通知 —',
  substitutionHeading: '您预订的车辆已变更。您的新车辆为:',
  newVehicleLabel: '新车辆',
  cancellationSubject: '预订取消通知 —',
  cancellationHeading: '您的预订已被取消。',
  cancellationFeeLabel: '取消费用',
  tripStartedSubject: '行程开始通知 —',
  tripStartedHeading: '您的租赁已开始。祝您旅途愉快!',
  tripCompletedSubject: '行程完成通知 —',
  tripCompletedHeading: '您的租赁已完成。感谢您的惠顾!',
  feeLabels: {
    OVERTIME_HOURLY: '超时费(每小时)',
    CLEANING_FLAT: '清洁费',
    NO_FUEL_FLAT: '加油费',
  },
  complianceSubject: '车辆合规提醒 —',
  complianceHeading: '以下车辆证件需要处理:',
  complianceDocLabels: { SHAKEN: '车检', INSURANCE: '保险' },
  complianceBandLabels: {
    MISSING: '未登记证件',
    EXPIRED: '已过期',
    D30: '30天后到期',
    D14: '14天后到期',
    D7: '7天后到期',
    D1: '1天内到期',
  },
}

const MESSAGES: Record<EmailLocale, EmailStrings> = { en, ja, zh }

/** Pick the locale's strings, falling back to en for any unknown code (§4c). */
export function emailStrings(locale: string): EmailStrings {
  return MESSAGES[locale as EmailLocale] ?? en
}
