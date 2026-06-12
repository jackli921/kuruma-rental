import { turnaroundHours } from '@/vite/storefronts/turnaround'
import { describe, expect, it } from 'vitest'

// #551: the storefront card/detail surface the operator's turnaround buffer as
// "~Nh between rentals". The raw minutes are rounded to the nearest half-hour so
// the label stays readable (90 -> 1.5h, the 48h default -> 48h).
describe('turnaroundHours', () => {
  it('converts whole-hour buffers exactly', () => {
    expect(turnaroundHours(60)).toBe(1)
    expect(turnaroundHours(120)).toBe(2)
    expect(turnaroundHours(180)).toBe(3)
  })

  it('keeps half hours so 90 minutes reads as 1.5h', () => {
    expect(turnaroundHours(90)).toBe(1.5)
  })

  it('rounds to the nearest half hour', () => {
    expect(turnaroundHours(75)).toBe(1.5)
    expect(turnaroundHours(100)).toBe(1.5)
  })

  it('surfaces the long defaults that drive the no-availability illusion', () => {
    expect(turnaroundHours(1440)).toBe(24)
    expect(turnaroundHours(2880)).toBe(48)
  })
})
