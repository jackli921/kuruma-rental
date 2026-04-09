import { describe, expect, it } from 'vitest'
import { formatDateTime } from '@/lib/format'

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
