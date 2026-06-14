import { describe, expect, it } from 'vitest'
import { renderOperatorAlert } from '../../../src/services/email/templates/operator-alert'
import type { RenterCancellationData } from '../../../src/services/email/templates/renter-cancellation'
import { renderRenterCancellation } from '../../../src/services/email/templates/renter-cancellation'
import type { RenterConfirmationData } from '../../../src/services/email/templates/renter-confirmation'
import { renderRenterConfirmation } from '../../../src/services/email/templates/renter-confirmation'
import type { RenterStatusUpdateData } from '../../../src/services/email/templates/renter-status-update'
import { renderRenterStatusUpdate } from '../../../src/services/email/templates/renter-status-update'

// §4c / §7: renderers are a PURE functional core — data in, {subject, html, text}
// out, zero I/O. Tests assert exact, mutation-resistant strings: the booking code,
// the resolved location NAMES (not IDs — P2e), the EXACT pre-auth URL, every fee
// line, and localized subjects. Missing pre-auth URL omits the CTA entirely.

const baseRenter: RenterConfirmationData = {
  bookingCode: 'ABCD2345',
  operatorName: 'Best Car Rental',
  vehicle: {
    name: 'Toyota Aqua',
    make: 'Toyota',
    model: 'Aqua',
    licensePlate: 'なにわ 300 あ 12-34',
  },
  pickupLocationName: 'Namba Station Lot',
  dropoffLocationName: 'Kansai Airport Lot',
  startAt: new Date('2026-07-01T10:00:00Z'),
  endAt: new Date('2026-07-03T18:00:00Z'),
  insurance: { name: 'Full Cover', dailyPriceJpy: 1500 },
  fees: [
    { feeType: 'OVERTIME_HOURLY', unit: 'PER_HOUR', amountJpy: 2000, vehicleClassId: null },
    { feeType: 'CLEANING_FLAT', unit: 'FLAT', amountJpy: 5000, vehicleClassId: null },
  ],
  preAuthHandoffUrl: 'https://pay.bestcarrental.jp/handoff/ABCD2345',
  totalPriceJpy: 24000,
}

describe('renderRenterConfirmation', () => {
  it('includes booking code, location names, insurance, and every fee line (en)', () => {
    const { subject, html, text } = renderRenterConfirmation(baseRenter, 'en')
    expect(subject).toContain('ABCD2345')
    for (const body of [html, text]) {
      expect(body).toContain('ABCD2345')
      expect(body).toContain('Namba Station Lot')
      expect(body).toContain('Kansai Airport Lot')
      expect(body).toContain('Full Cover')
      expect(body).toContain('2,000') // overtime/hour
      expect(body).toContain('5,000') // cleaning flat
    }
    expect(text.length).toBeGreaterThan(0)
  })

  it('renders pickup/return in JST wall-clock with a label — incl. the +9h date rollover (#680)', () => {
    const { html, text } = renderRenterConfirmation(baseRenter, 'en')
    for (const body of [html, text]) {
      // startAt 10:00 UTC -> 19:00 JST same day; endAt 18:00 UTC -> 03:00 JST NEXT day.
      expect(body).toContain('2026-07-01 19:00 JST')
      expect(body).toContain('2026-07-04 03:00 JST')
      expect(body).not.toContain('UTC')
    }
  })

  it('renders the pre-auth CTA with the EXACT handoff URL when present', () => {
    const { html, text } = renderRenterConfirmation(baseRenter, 'en')
    expect(html).toContain('https://pay.bestcarrental.jp/handoff/ABCD2345')
    expect(text).toContain('https://pay.bestcarrental.jp/handoff/ABCD2345')
  })

  it('omits the pre-auth CTA entirely when the URL is null', () => {
    const { html, text } = renderRenterConfirmation(
      { ...baseRenter, preAuthHandoffUrl: null },
      'en',
    )
    expect(html).not.toContain('handoff')
    expect(text).not.toContain('handoff')
  })

  it('localizes the subject line for ja and zh (specific strings, not truthy)', () => {
    expect(renderRenterConfirmation(baseRenter, 'ja').subject).toContain('予約確認')
    expect(renderRenterConfirmation(baseRenter, 'zh').subject).toContain('预订确认')
  })

  it('falls back to en for an unknown locale', () => {
    const en = renderRenterConfirmation(baseRenter, 'en').subject
    expect(renderRenterConfirmation(baseRenter, 'fr').subject).toBe(en)
  })
})

describe('renderOperatorAlert', () => {
  const baseOp = {
    bookingCode: 'ABCD2345',
    vehicle: baseRenter.vehicle,
    pickupLocationName: 'Namba Station Lot',
    dropoffLocationName: 'Kansai Airport Lot',
    startAt: baseRenter.startAt,
    endAt: baseRenter.endAt,
    renterName: 'Jane Tourist',
    totalPriceJpy: 24000,
  }

  it('includes booking code, vehicle, renter, and location names (ja default)', () => {
    const { subject, html, text } = renderOperatorAlert(baseOp, 'ja')
    expect(subject).toContain('ABCD2345')
    expect(subject).toContain('新規予約') // "new booking"
    for (const body of [html, text]) {
      expect(body).toContain('ABCD2345')
      expect(body).toContain('Jane Tourist')
      expect(body).toContain('Namba Station Lot')
      expect(body).toContain('Toyota Aqua')
    }
    expect(text.length).toBeGreaterThan(0)
  })

  it('renders en when requested', () => {
    expect(renderOperatorAlert(baseOp, 'en').subject).toContain('New booking')
  })
})

// A raw entity UUID must never leak into a renter-facing body — only the human
// booking code (e.g. WXYZ7890) should appear. This guards the #664 lifecycle
// renderers against a future row accidentally interpolating data.id.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

describe('renderRenterStatusUpdate', () => {
  const baseStatus: RenterStatusUpdateData = {
    status: 'ACTIVE',
    bookingCode: 'WXYZ7890',
    vehicle: { name: 'Honda Fit', licensePlate: 'なにわ 500 か 56-78' },
    pickupLocationName: 'Namba Station Lot',
    dropoffLocationName: 'Kansai Airport Lot',
    startAt: new Date('2026-07-01T10:00:00Z'),
    endAt: new Date('2026-07-03T18:00:00Z'),
  }

  it('localizes the ACTIVE (trip started) subject for en/ja/zh and appends the booking code', () => {
    expect(renderRenterStatusUpdate(baseStatus, 'en').subject).toContain('Trip started')
    expect(renderRenterStatusUpdate(baseStatus, 'ja').subject).toContain('レンタル開始のお知らせ')
    expect(renderRenterStatusUpdate(baseStatus, 'zh').subject).toContain('行程开始通知')
    expect(renderRenterStatusUpdate(baseStatus, 'en').subject).toContain('WXYZ7890')
  })

  it('localizes the COMPLETED (trip completed) subject for en/ja/zh', () => {
    const completed = { ...baseStatus, status: 'COMPLETED' as const }
    expect(renderRenterStatusUpdate(completed, 'en').subject).toContain('Trip completed')
    expect(renderRenterStatusUpdate(completed, 'ja').subject).toContain('レンタル完了のお知らせ')
    expect(renderRenterStatusUpdate(completed, 'zh').subject).toContain('行程完成通知')
  })

  it('puts the booking code and location names in the body, with no raw UUID', () => {
    const { html, text } = renderRenterStatusUpdate(baseStatus, 'en')
    for (const body of [html, text]) {
      expect(body).toContain('WXYZ7890')
      expect(body).toContain('Namba Station Lot')
      expect(body).toContain('Kansai Airport Lot')
      expect(body).not.toMatch(UUID_RE)
    }
  })

  it('falls back to the en subject for an unknown locale', () => {
    expect(renderRenterStatusUpdate(baseStatus, 'fr').subject).toContain('Trip started')
  })
})

describe('renderRenterCancellation', () => {
  const baseCancel: RenterCancellationData = {
    bookingCode: 'WXYZ7890',
    startAt: new Date('2026-07-01T10:00:00Z'),
    endAt: new Date('2026-07-03T18:00:00Z'),
    cancellationFeeJpy: null,
  }

  it('localizes the subject for en/ja/zh and appends the booking code', () => {
    expect(renderRenterCancellation(baseCancel, 'en').subject).toContain('Booking cancelled')
    expect(renderRenterCancellation(baseCancel, 'ja').subject).toContain(
      'ご予約キャンセルのお知らせ',
    )
    expect(renderRenterCancellation(baseCancel, 'zh').subject).toContain('预订取消通知')
    expect(renderRenterCancellation(baseCancel, 'en').subject).toContain('WXYZ7890')
  })

  it('puts the booking code in the body, with no raw UUID', () => {
    const { html, text } = renderRenterCancellation(baseCancel, 'en')
    for (const body of [html, text]) {
      expect(body).toContain('WXYZ7890')
      expect(body).not.toMatch(UUID_RE)
    }
  })

  it('shows the cancellation-fee line only when a fee was actually charged', () => {
    const charged = renderRenterCancellation({ ...baseCancel, cancellationFeeJpy: 7000 }, 'en')
    expect(charged.html).toContain('Cancellation fee')
    expect(charged.text).toContain('¥7,000')

    const free = renderRenterCancellation(baseCancel, 'en')
    expect(free.html).not.toContain('Cancellation fee')
    expect(free.text).not.toContain('Cancellation fee')
  })

  it('falls back to the en subject for an unknown locale', () => {
    expect(renderRenterCancellation(baseCancel, 'fr').subject).toContain('Booking cancelled')
  })
})
