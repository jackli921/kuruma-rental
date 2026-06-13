import {
  type SubstitutionBooking,
  type SubstitutionCandidate,
  selectSubstitutionCandidates,
} from '@/lib/substitution'
import { describe, expect, it } from 'vitest'

// The candidate filter MUST mirror the server's substitution rules exactly
// (same operator + class + pickup location, AVAILABLE, not the current car) so
// an operator can never pick a car the POST would 400/409 on (#610).
function candidate(over: Partial<SubstitutionCandidate> = {}): SubstitutionCandidate {
  return {
    id: 'veh-2',
    classId: 'class-compact',
    pickupLocationId: 'loc-namba',
    status: 'AVAILABLE',
    ...over,
  }
}

const booking: SubstitutionBooking = {
  classId: 'class-compact',
  pickupLocationId: 'loc-namba',
  assignedVehicleId: 'veh-1',
}

describe('selectSubstitutionCandidates', () => {
  it('keeps an AVAILABLE car of the same class at the same pickup location', () => {
    const result = selectSubstitutionCandidates([candidate({ id: 'veh-2' })], booking)
    expect(result.map((v) => v.id)).toEqual(['veh-2'])
  })

  it('excludes a car of a different class', () => {
    const result = selectSubstitutionCandidates(
      [candidate({ id: 'veh-2', classId: 'class-van' })],
      booking,
    )
    expect(result).toEqual([])
  })

  it('excludes a car at a different pickup location', () => {
    const result = selectSubstitutionCandidates(
      [candidate({ id: 'veh-2', pickupLocationId: 'loc-umeda' })],
      booking,
    )
    expect(result).toEqual([])
  })

  it('excludes a car that is not AVAILABLE (maintenance / retired)', () => {
    const result = selectSubstitutionCandidates(
      [
        candidate({ id: 'veh-2', status: 'MAINTENANCE' }),
        candidate({ id: 'veh-3', status: 'RETIRED' }),
      ],
      booking,
    )
    expect(result).toEqual([])
  })

  it('excludes the booking’s currently assigned vehicle', () => {
    const result = selectSubstitutionCandidates([candidate({ id: 'veh-1' })], booking)
    expect(result).toEqual([])
  })

  it('returns every matching car and only those', () => {
    const result = selectSubstitutionCandidates(
      [
        candidate({ id: 'veh-1' }), // assigned — excluded
        candidate({ id: 'veh-2' }), // match
        candidate({ id: 'veh-3', classId: 'class-van' }), // wrong class
        candidate({ id: 'veh-4', status: 'MAINTENANCE' }), // unavailable
        candidate({ id: 'veh-5' }), // match
      ],
      booking,
    )
    expect(result.map((v) => v.id)).toEqual(['veh-2', 'veh-5'])
  })
})
