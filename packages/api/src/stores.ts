export interface Vehicle {
  id: string
  name: string
  description: string | null
  photos: string[]
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
  effectiveEndAt: Date
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  externalId: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

// Map stores removed — repositories handle data access now.
// Types remain here as the shared contract between repositories and routes.
