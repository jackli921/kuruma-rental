import type { AvailableVehicleData, ClassOfferingData } from '@/vite/storefronts/api'
import { describe, expect, it } from 'vitest'
import { estimateReservation } from './pricing'
import { type ReservationSubject, subjectDisplay, subjectRates } from './subject'

// A concrete car (#391) and a class-combo deal (#464): the wizard books either,
// resolving pricing + display through this pure seam so the render + submit paths
// never branch on the discriminant themselves.
const vehicle: AvailableVehicleData = {
  id: 'v1',
  classId: 'c1',
  name: 'Toyota Aqua',
  make: 'Toyota',
  model: 'Aqua',
  year: 2024,
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'MEDIUM',
  transmission: 'AUTO',
  acrissCode: 'CDMR',
  classLabel: 'Compact',
  dailyRateJpy: 8000,
  hourlyRateJpy: 1200,
  photos: ['veh-front.jpg', 'veh-side.jpg'],
}

const offering: ClassOfferingData = {
  kind: 'CLASS_COMBO',
  location: {
    locationId: 'loc1',
    operatorId: 'op1',
    operatorName: 'Osaka Cars',
    name: 'Namba Store',
    address: '1-1 Namba',
    latitude: null,
    longitude: null,
  },
  dailyRateJpy: 6000,
  hourlyRateJpy: null,
  classLabel: 'Economy',
  acrissCode: 'ECMR',
  seats: 4,
  photos: ['class-eco.jpg'],
  classId: 'class-eco',
  availableCount: 3,
}

const specificSubject: ReservationSubject = { kind: 'SPECIFIC', vehicle }
const comboSubject: ReservationSubject = { kind: 'CLASS_COMBO', offering }

describe('subjectRates', () => {
  it('reads the concrete car rates for a SPECIFIC subject', () => {
    expect(subjectRates(specificSubject)).toEqual({ dailyRateJpy: 8000, hourlyRateJpy: 1200 })
  })

  it('reads the class rate plan for a CLASS_COMBO subject (hourly always null)', () => {
    expect(subjectRates(comboSubject)).toEqual({ dailyRateJpy: 6000, hourlyRateJpy: null })
  })
})

describe('subjectDisplay', () => {
  it('names the car, its first photo and seats for a SPECIFIC subject', () => {
    expect(subjectDisplay(specificSubject)).toEqual({
      label: 'Toyota Aqua',
      photo: 'veh-front.jpg',
      seats: 5,
    })
  })

  it('names the class label, its first photo and seats for a CLASS_COMBO subject', () => {
    expect(subjectDisplay(comboSubject)).toEqual({
      label: 'Economy',
      photo: 'class-eco.jpg',
      seats: 4,
    })
  })

  it('coalesces a missing photo to null (noUncheckedIndexedAccess)', () => {
    const photoless: ReservationSubject = {
      kind: 'CLASS_COMBO',
      offering: { ...offering, photos: [] },
    }
    expect(subjectDisplay(photoless).photo).toBeNull()
  })
})

describe('subjectRates feeds the price estimate', () => {
  it('prices a short CLASS_COMBO to the day-rate floor, not 0 or NaN', () => {
    // A 3-hour class-combo with a daily-only rate plan: the shared pricing rounds
    // any partial day up to one day, so the estimate must floor at ￥6,000 — never
    // 0 (dropped rate) or NaN (null hourly leaking through).
    const from = new Date('2026-08-01T10:00:00+09:00')
    const to = new Date('2026-08-01T13:00:00+09:00')
    const estimate = estimateReservation({
      vehicle: subjectRates(comboSubject),
      from,
      to,
      insuranceDailyPriceJpy: null,
      addOnPricesJpy: [],
    })
    expect(estimate.baseJpy).toBe(6000)
    expect(estimate.totalJpy).toBe(6000)
  })
})
