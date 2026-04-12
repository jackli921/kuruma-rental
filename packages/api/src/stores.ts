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
  // JPY rates. At least one is non-null (enforced by DB CHECK constraint
  // `vehicles_pricing_at_least_one` and by createVehicleSchema). See #48.
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
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
  totalPrice: number | null
  cancellationFee: number | null
  cancelledAt: Date | null
  idempotencyKey: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Thread {
  id: string
  bookingId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface ThreadParticipant {
  id: string
  threadId: string
  userId: string
  unreadCount: number
}

export interface Message {
  id: string
  threadId: string
  senderId: string
  content: string
  sourceLanguage: string | null
  translations: string
  createdAt: Date
}

// Map stores removed — repositories handle data access now.
// Types remain here as the shared contract between repositories and routes.
