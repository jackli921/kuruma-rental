import type { VehicleData } from '@/lib/vehicle-api'

export type VehicleStatus = VehicleData['status']
export type Transmission = VehicleData['transmission']

export interface FleetFilterState {
  search?: string | undefined
  statuses?: VehicleStatus[]
  transmissions?: Transmission[]
  seatsMin?: number
  seatsMax?: number
}

// Generic in T so the owner list (FleetVehicleOverviewData) and any
// other caller that wants to narrow a list of vehicle-shaped items
// keeps its concrete type through the filter. See #52.
type FilterableVehicle = Pick<VehicleData, 'name' | 'status' | 'transmission' | 'seats'>

export function filterVehicles<T extends FilterableVehicle>(
  vehicles: T[],
  filters: FleetFilterState,
): T[] {
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

export type SortOrder =
  | 'name-asc'
  | 'name-desc'
  | 'seats-asc'
  | 'seats-desc'
  | 'utilization-desc'
  | 'price-asc'
  | 'price-desc'

// Generic over anything shaped like a vehicle with the columns sortVehicles
// touches. `utilization` is optional so plain VehicleData and
// FleetVehicleOverviewData both satisfy the constraint — `utilization-desc`
// treats a missing value as 0 (safe for the owner page, which always
// hydrates with the overview data anyway). See #52.
type SortableVehicle = Pick<VehicleData, 'name' | 'seats' | 'dailyRateJpy' | 'hourlyRateJpy'> & {
  utilization?: number
}

// Price sort uses dailyRateJpy first, falling back to hourlyRateJpy.
// Vehicles with neither rate sort to the end. This prioritizes daily
// pricing because that's the headline rate on the owner's mental model
// ("how much does this car earn per day?") and matches how the row
// component displays the rates.
function priceKey(v: SortableVehicle): number {
  if (v.dailyRateJpy != null) return v.dailyRateJpy
  if (v.hourlyRateJpy != null) return v.hourlyRateJpy
  return Number.POSITIVE_INFINITY
}

export function sortVehicles<T extends SortableVehicle>(vehicles: T[], order: SortOrder): T[] {
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
    case 'utilization-desc':
      return sorted.sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))
    case 'price-asc':
      return sorted.sort((a, b) => priceKey(a) - priceKey(b))
    case 'price-desc':
      return sorted.sort((a, b) => priceKey(b) - priceKey(a))
  }
}
