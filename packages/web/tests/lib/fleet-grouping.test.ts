import { type FleetClassGroup, groupVehiclesByClassId } from '@/lib/fleet-grouping'
import { describe, expect, it } from 'vitest'

interface Row {
  id: string
  classId: string | null
}

function v(id: string, classId: string | null): Row {
  return { id, classId }
}

// classNames map order is the display order (server returns classes sortOrder-ordered).
const names = new Map([
  ['c_compact', 'Compact'],
  ['c_suv', 'SUV'],
])

describe('groupVehiclesByClassId', () => {
  it('groups vehicles under their class name, preserving class map order', () => {
    const groups = groupVehiclesByClassId(
      [v('a', 'c_suv'), v('b', 'c_compact'), v('c', 'c_suv')],
      names,
      'Unassigned',
    )
    expect(groups.map((g) => g.className)).toEqual(['Compact', 'SUV'])
    expect(groups[0]).toMatchObject({ classId: 'c_compact', vehicles: [v('b', 'c_compact')] })
    expect(groups[1]?.vehicles.map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('drops classes that have no vehicles', () => {
    const groups = groupVehiclesByClassId([v('a', 'c_suv')], names, 'Unassigned')
    expect(groups.map((g) => g.classId)).toEqual(['c_suv'])
  })

  it('puts null-classId vehicles in a trailing Unassigned group', () => {
    const groups = groupVehiclesByClassId([v('a', 'c_compact'), v('b', null)], names, 'Unassigned')
    expect(groups.map((g) => g.className)).toEqual(['Compact', 'Unassigned'])
    const last = groups.at(-1) as FleetClassGroup<Row>
    expect(last).toMatchObject({ classId: null, vehicles: [v('b', null)] })
  })

  it('treats a classId with no matching name as Unassigned', () => {
    const groups = groupVehiclesByClassId([v('a', 'c_ghost')], names, 'Unassigned')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ classId: null, className: 'Unassigned' })
  })

  it('returns an empty array for no vehicles', () => {
    expect(groupVehiclesByClassId([], names, 'Unassigned')).toEqual([])
  })
})
