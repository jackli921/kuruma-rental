import { formatFromPriceLabel, preferredRateJpy } from '@/vite/pricing-label'
import { describe, expect, it } from 'vitest'

// Fake translator mirroring tests/vite/search/result.test.ts: renders the key with
// its interpolated price so we assert both template selection and value wiring.
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${values.price}` : key

describe('preferredRateJpy', () => {
  it('prefers the daily rate when both are present', () => {
    expect(preferredRateJpy(8000, 500)).toBe(8000)
  })
  it('falls back to the hourly rate when there is no daily rate', () => {
    expect(preferredRateJpy(null, 500)).toBe(500)
  })
  it('is null when neither rate is set (price on request)', () => {
    expect(preferredRateJpy(null, null)).toBeNull()
  })
})

describe('formatFromPriceLabel', () => {
  it('formats a daily rate with thousands separators', () => {
    expect(formatFromPriceLabel(8000, null, t)).toBe('fromDaily:8,000')
  })
  it('prefers the daily label even when an hourly rate is also set', () => {
    expect(formatFromPriceLabel(12000, 500, t)).toBe('fromDaily:12,000')
  })
  it('falls back to the hourly label when there is no daily rate', () => {
    expect(formatFromPriceLabel(null, 500, t)).toBe('fromHourly:500')
  })
  it('shows the no-price label when neither rate is set', () => {
    expect(formatFromPriceLabel(null, null, t)).toBe('noPrice')
  })
})
