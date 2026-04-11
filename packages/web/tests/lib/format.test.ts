import { formatDateTime, formatJpy, formatVehicleRate } from '@/lib/format'
import { describe, expect, it } from 'vitest'

describe('formatDateTime', () => {
  // 2026-04-10T00:00:00Z = 2026-04-10 09:00 JST
  const date = new Date('2026-04-10T00:00:00Z')

  it('formats date in JST for English locale', () => {
    const result = formatDateTime(date, 'en')
    // Should show Apr 10, 2026 and 9:00 AM (JST)
    expect(result).toContain('Apr')
    expect(result).toContain('10')
    expect(result).toContain('2026')
    expect(result).toContain('9:00')
  })

  it('formats date in JST for Japanese locale', () => {
    const result = formatDateTime(date, 'ja')
    // Japanese format uses different date structure
    expect(result).toContain('2026')
    expect(result).toContain('4')
    expect(result).toContain('10')
  })

  it('formats date in JST for Chinese locale', () => {
    const result = formatDateTime(date, 'zh')
    expect(result).toContain('2026')
    expect(result).toContain('4')
    expect(result).toContain('10')
  })

  it('always uses Asia/Tokyo timezone regardless of locale', () => {
    // Midnight UTC = 9:00 AM JST
    const enResult = formatDateTime(date, 'en')
    expect(enResult).toContain('9:00')
  })
})

describe('formatJpy', () => {
  it('formats whole yen with no decimal places', () => {
    expect(formatJpy(8000)).toBe('￥8,000')
  })

  it('formats zero as ￥0', () => {
    expect(formatJpy(0)).toBe('￥0')
  })

  it('formats large amounts with thousands separators', () => {
    expect(formatJpy(1234567)).toBe('￥1,234,567')
  })
})

describe('formatVehicleRate', () => {
  const labels = { perDay: '/day', perHour: '/hr' }

  it('returns just the daily rate when only daily is set', () => {
    expect(formatVehicleRate(8000, null, labels)).toBe('￥8,000/day')
  })

  it('returns just the hourly rate when only hourly is set', () => {
    expect(formatVehicleRate(null, 1200, labels)).toBe('￥1,200/hr')
  })

  it('returns both rates separated by a middle dot when both are set', () => {
    expect(formatVehicleRate(8000, 1200, labels)).toBe('￥8,000/day · ￥1,200/hr')
  })

  it('returns null when both rates are null (shouldnt happen post-#48 but be defensive)', () => {
    expect(formatVehicleRate(null, null, labels)).toBeNull()
  })

  it('renders zero as a valid free-promo rate', () => {
    expect(formatVehicleRate(0, null, labels)).toBe('￥0/day')
  })

  it('honours locale-agnostic labels (i18n callers pass their own strings)', () => {
    const ja = formatVehicleRate(8000, null, { perDay: '/日', perHour: '/時間' })
    expect(ja).toBe('￥8,000/日')
  })
})
