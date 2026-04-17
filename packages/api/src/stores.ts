export interface VehicleClass {
  id: string
  name: string
  slug: string
  description: string | null
  photos: string[]
  seats: number
  luggageCapacity: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  sortOrder: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: Date
  updatedAt: Date
}

export type { VehicleBase as Vehicle } from '@kuruma/shared/types/vehicle'

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
  idempotencyKey: string | null
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
  idempotencyKey: string | null
  createdAt: Date
}

export interface MaintenanceLog {
  id: string
  vehicleId: string
  reason: string
  notes: string | null
  costJpy: number | null
  startedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface User {
  id: string
  name: string | null
  // email may be null for phone-only customers created via /customers/quick-create.
  // Storage keeps a synthetic placeholder (Auth.js adapter requires NOT NULL) but
  // repository reads mask it back to null so API consumers never see it.
  email: string | null
  phone: string | null
  language: string
  role?: 'RENTER' | 'STAFF' | 'ADMIN'
}

// Map stores removed — repositories handle data access now.
// Types remain here as the shared contract between repositories and routes.
