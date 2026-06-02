export type VehicleStatus = 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
export type Transmission = 'AUTO' | 'MANUAL'

export interface VehicleBase {
  id: string
  /** Owning operator (marketplace tenant, #386). NOT NULL in the DB. */
  operatorId: string
  classId: string | null
  name: string
  description: string | null
  photos: string[]
  seats: number
  transmission: Transmission
  fuelType: string | null
  licensePlate: string | null
  status: VehicleStatus
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  make: string | null
  model: string | null
  year: number | null
  color: string | null
  // JPY rates. At least one is non-null (enforced by DB CHECK constraint
  // `vehicles_pricing_at_least_one` and by createVehicleSchema). See #48.
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  shakenExpiryDate: string | null
  insuranceExpiryDate: string | null
  createdAt: Date
  updatedAt: Date
}
