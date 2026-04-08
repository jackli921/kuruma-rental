export interface Vehicle {
  id: string
  name: string
  description: string | null
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  createdAt: Date
  updatedAt: Date
}

export interface Booking {
  id: string
  renterId: string
  vehicleId: string
  startAt: Date
  endAt: Date
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  externalId: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

let vehicleStore = new Map<string, Vehicle>()
let bookingStore = new Map<string, Booking>()

export function getVehicleStore(): Map<string, Vehicle> {
  return vehicleStore
}

export function resetVehicleStore(): void {
  vehicleStore = new Map()
}

export function getBookingStore(): Map<string, Booking> {
  return bookingStore
}

export function resetBookingStore(): void {
  bookingStore = new Map()
}
