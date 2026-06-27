import { describe, expect, it } from 'vitest'
import type { OperatorAlertData } from '../../../src/services/email/templates/operator-alert'
import { renderOperatorAlert } from '../../../src/services/email/templates/operator-alert'
import type { RenterCancellationData } from '../../../src/services/email/templates/renter-cancellation'
import { renderRenterCancellation } from '../../../src/services/email/templates/renter-cancellation'
import type { RenterConfirmationData } from '../../../src/services/email/templates/renter-confirmation'
import { renderRenterConfirmation } from '../../../src/services/email/templates/renter-confirmation'
import type { RenterReviewPromptData } from '../../../src/services/email/templates/renter-review-prompt'
import { renderRenterReviewPrompt } from '../../../src/services/email/templates/renter-review-prompt'
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
  const baseOp: OperatorAlertData = {
    bookingCode: 'ABCD2345',
    vehicle: baseRenter.vehicle,
    pickupLocationName: 'Namba Station Lot',
    dropoffLocationName: 'Kansai Airport Lot',
    startAt: baseRenter.startAt, // 2026-07-01T10:00Z
    endAt: baseRenter.endAt, // 2026-07-03T18:00Z -> 56h = 2d 8h
    renterName: 'Jane Tourist',
    renterEmail: 'jane@example.com',
    renterPhone: '+81 90-1234-5678',
    insurance: { name: 'Full Cover', dailyPriceJpy: 1500 },
    addOns: [{ addOnId: 'ao-1', name: 'Child Seat', priceJpy: 2000 }],
    source: 'DIRECT',
    totalPriceJpy: 24000,
    manageBookingUrl: 'https://app.kuruma.jp/ja/manage/bookings/bk-1',
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

  it('includes the renter contact (email + phone) so the operator can reach them', () => {
    const { html, text } = renderOperatorAlert(baseOp, 'en')
    for (const body of [html, text]) {
      expect(body).toContain('Contact')
      expect(body).toContain('jane@example.com')
      expect(body).toContain('+81 90-1234-5678')
    }
  })

  it('omits the contact row entirely when the renter has neither email nor phone', () => {
    const { html, text } = renderOperatorAlert(
      { ...baseOp, renterEmail: null, renterPhone: null },
      'en',
    )
    for (const body of [html, text]) {
      expect(body).not.toContain('Contact')
      expect(body).not.toContain('jane@example.com')
    }
  })

  it('shows the rental duration, insurance, and source', () => {
    const { html, text } = renderOperatorAlert(baseOp, 'en')
    for (const body of [html, text]) {
      expect(body).toContain('2d 8h') // 56h
      expect(body).toContain('Full Cover')
      expect(body).toContain('Direct') // DIRECT source label
    }
  })

  it('maps the Trip.com source to its display name', () => {
    expect(renderOperatorAlert({ ...baseOp, source: 'TRIP_COM' }, 'en').html).toContain('Trip.com')
  })

  it('localizes the duration units (ja -> 日/時間)', () => {
    expect(renderOperatorAlert(baseOp, 'ja').text).toContain('2日 8時間')
  })

  it('lists paid add-ons with their prices, and omits the section when there are none', () => {
    const withAddOns = renderOperatorAlert(baseOp, 'en')
    expect(withAddOns.html).toContain('Child Seat')
    expect(withAddOns.text).toContain('Child Seat')
    expect(withAddOns.text).toContain('¥2,000')

    const none = renderOperatorAlert({ ...baseOp, addOns: [] }, 'en')
    expect(none.html).not.toContain('Child Seat')
    expect(none.html).not.toContain('Add-ons')
  })

  it('renders a deep link with the EXACT manage-booking URL when present', () => {
    const { html, text } = renderOperatorAlert(baseOp, 'en')
    expect(html).toContain('href="https://app.kuruma.jp/ja/manage/bookings/bk-1"')
    expect(text).toContain('https://app.kuruma.jp/ja/manage/bookings/bk-1')
  })

  it('omits the deep link entirely when the URL is null', () => {
    const { html, text } = renderOperatorAlert({ ...baseOp, manageBookingUrl: null }, 'en')
    expect(html).not.toContain('manage/bookings')
    expect(text).not.toContain('manage/bookings')
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

describe('renderRenterReviewPrompt', () => {
  const basePrompt: RenterReviewPromptData = {
    bookingCode: 'RVEW1234',
    startAt: new Date('2026-07-01T10:00:00Z'),
    endAt: new Date('2026-07-03T18:00:00Z'),
    reviewUrl: 'https://app.kuruma.jp/en/bookings',
  }

  it('localizes a distinct subject for en/ja/zh and appends the booking code', () => {
    const en = renderRenterReviewPrompt(basePrompt, 'en').subject
    const ja = renderRenterReviewPrompt(basePrompt, 'ja').subject
    const zh = renderRenterReviewPrompt(basePrompt, 'zh').subject
    expect(en).toContain('RVEW1234')
    expect(ja).toContain('RVEW1234')
    expect(zh).toContain('RVEW1234')
    // mutation-resistant: the three locales are genuinely different strings
    expect(new Set([en, ja, zh]).size).toBe(3)
  })

  it('renders the review CTA link in html and text when reviewUrl is present', () => {
    const { html, text } = renderRenterReviewPrompt(basePrompt, 'en')
    expect(html).toContain('href="https://app.kuruma.jp/en/bookings"')
    expect(text).toContain('https://app.kuruma.jp/en/bookings')
    expect(html).toContain('RVEW1234')
    expect(html).not.toMatch(UUID_RE)
  })

  it('omits the CTA entirely when reviewUrl is null but still names the booking', () => {
    const { subject, html } = renderRenterReviewPrompt({ ...basePrompt, reviewUrl: null }, 'en')
    expect(subject).toContain('RVEW1234')
    expect(html).not.toContain('href=')
  })

  it('falls back to the en subject for an unknown locale', () => {
    const en = renderRenterReviewPrompt(basePrompt, 'en').subject
    expect(renderRenterReviewPrompt(basePrompt, 'fr').subject).toBe(en)
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
