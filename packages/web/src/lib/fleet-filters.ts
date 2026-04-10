import type { VehicleData } from '@/lib/vehicle-api'

export type VehicleStatus = VehicleData['status']
export type Transmission = VehicleData['transmission']

export interface FleetFilterState {
  search?: string
  statuses?: VehicleStatus[]
  transmissions?: Transmission[]
  seatsMin?: number
  seatsMax?: number
}

export function filterVehicles(vehicles: VehicleData[], filters: FleetFilterState): VehicleData[] {
  let result = vehicles

  if (filters.search) {
    const needle = filters.search.toLocaleLowerCase()
    result = result.filter((v) => v.name.toLocaleLowerCase().includes(needle))
  }

  if (filters.statuses && filters.statuses.length > 0) {
    const allowed = new Set(filters.statuses)
    result = result.filter((v) => allowed.has(v.status))
  }

  if (filters.transmissions && filters.transmissions.length > 0) {
    const allowed = new Set(filters.transmissions)
    result = result.filter((v) => allowed.has(v.transmission))
  }

  if (filters.seatsMin !== undefined) {
    const min = filters.seatsMin
    result = result.filter((v) => v.seats >= min)
  }

  if (filters.seatsMax !== undefined) {
    const max = filters.seatsMax
    result = result.filter((v) => v.seats <= max)
  }

  return result
}

export type SortOrder = 'name-asc' | 'name-desc' | 'seats-asc' | 'seats-desc'

export function sortVehicles(vehicles: VehicleData[], order: SortOrder): VehicleData[] {
  const sorted = [...vehicles]

  switch (order) {
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name))
    case 'seats-asc':
      return sorted.sort((a, b) => a.seats - b.seats)
    case 'seats-desc':
      return sorted.sort((a, b) => b.seats - a.seats)
  }
}
