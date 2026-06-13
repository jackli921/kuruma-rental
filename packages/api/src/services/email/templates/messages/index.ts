import type { FeeType } from '@kuruma/shared/db/schema'

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
}

const MESSAGES: Record<EmailLocale, EmailStrings> = { en, ja, zh }

/** Pick the locale's strings, falling back to en for any unknown code (§4c). */
export function emailStrings(locale: string): EmailStrings {
  return MESSAGES[locale as EmailLocale] ?? en
}
