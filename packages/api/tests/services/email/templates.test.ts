import { describe, expect, it } from 'vitest'
import { renderOperatorAlert } from '../../../src/services/email/templates/operator-alert'
import type { RenterConfirmationData } from '../../../src/services/email/templates/renter-confirmation'
import { renderRenterConfirmation } from '../../../src/services/email/templates/renter-confirmation'

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
