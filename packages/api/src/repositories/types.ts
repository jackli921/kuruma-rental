export type {
  Vehicle,
  VehicleClass,
  Booking,
  User,
  Thread,
  ThreadParticipant,
  Message,
  MaintenanceLog,
} from '../stores'
export type { DashboardStats } from '@kuruma/shared/types/stats'
export type { FleetVehicleOverview, FleetBookingSummary } from '@kuruma/shared/types/fleet'
export type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'

import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import type { DashboardStats } from '@kuruma/shared/types/stats'
import type { VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
import type { CallerContext } from '../middleware/auth'
import type {
  Booking,
  MaintenanceLog,
  Message,
  Thread,
  ThreadParticipant,
  User,
  Vehicle,
  VehicleClass,
} from '../stores'

export interface VehicleFilters {
  status?: string
  includeRetired?: boolean
  limit?: number
  offset?: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
}

export interface VehicleUpdateOptions {
  expectedStatus?: Vehicle['status']
}

export interface VehicleRepository {
  findAll(filters?: VehicleFilters): Promise<PaginatedResult<Vehicle>>
  findById(id: string): Promise<Vehicle | undefined>
  findByIds(ids: string[]): Promise<Vehicle[]>
  create(data: Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<Vehicle>
  update(
    id: string,
    data: Partial<Vehicle>,
    options?: VehicleUpdateOptions,
  ): Promise<Vehicle | undefined>
  softDelete(id: string): Promise<Vehicle | undefined>
  bulkUpdateStatus(ids: string[], status: 'AVAILABLE' | 'MAINTENANCE'): Promise<Vehicle[]>
  // Atomic photo-array ops. Single SQL statements so concurrent callers
  // cannot race a read-modify-write on the photos array.
  appendPhotos(
    id: string,
    urls: string[],
    maxPhotos: number,
  ): Promise<
    { outcome: 'ok'; vehicle: Vehicle } | { outcome: 'cap_exceeded' } | { outcome: 'not_found' }
  >
  removePhotoByUrl(id: string, url: string): Promise<Vehicle | undefined>
}

// Aggregated read for the owner-facing /manage/vehicles list. Enriches
// each vehicle with utilization %, booking count, and current/next
// booking state. Computed per-request — NOT denormalized into the
// vehicles table. See issue #52 and @kuruma/shared/types/fleet.
//
// Split from VehicleRepository because it reads across multiple tables
// (vehicles + bookings + users.name) — following the same boundary as
// AvailabilityRepository, which also reads vehicles + bookings.
export interface FleetOverviewRepository {
  // `now` is injected so time-based cutoffs (utilization window,
  // current/upcoming filtering) live in callers, not infrastructure.
  // Tests can pass a fixed Date without faking the global clock.
  findFleetOverview(now: Date): Promise<FleetVehicleOverview[]>
}

export interface UserRepository {
  findByIds(ids: string[]): Promise<User[]>
  search(query: string): Promise<User[]>
  quickCreate(data: {
    name: string
    email: string | null
    phone: string | null
    language: string
  }): Promise<User>
  findByEmail(email: string): Promise<User | undefined>
  findByPhone(phone: string): Promise<User | undefined>
}

export interface BookingFilters {
  status?: string
  vehicleId?: string
  renterId?: string
  from?: Date
  to?: Date
  limit?: number
  cursor?: string
}

export type { CallerContext } from '../middleware/auth'

export interface BookingRepository {
  findAll(ctx: CallerContext, filters?: BookingFilters): Promise<Booking[]>
  findById(ctx: CallerContext, id: string): Promise<Booking | undefined>
  findByIdempotencyKey(ctx: CallerContext, key: string): Promise<Booking | undefined>
  create(
    ctx: CallerContext,
    data: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Booking>
  updateStatus(
    ctx: CallerContext,
    id: string,
    transition: { from: Booking['status']; to: Booking['status'] },
  ): Promise<Booking | undefined>
  cancel(
    ctx: CallerContext,
    id: string,
    opts: { from: Booking['status']; fee: number; cancelledAt: Date },
  ): Promise<Booking | undefined>
}

export interface StatsRepository {
  getDashboardStats(): Promise<DashboardStats>
}

export interface AvailabilityRepository {
  findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]>
  checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<
    | {
        available: boolean
        vehicle: Vehicle
        conflicts: Booking[]
      }
    | undefined
  >
}

// Enriched read for the owner-facing /manage/vehicles/[id] detail page.
// Returns a single vehicle with upcoming bookings, revenue, and utilization.
// See issue #53.
export interface VehicleDetailRepository {
  // `now` injected for the same reason as FleetOverviewRepository:
  // revenue window, upcoming-booking filtering, and utilization range
  // are business decisions owned by the service layer.
  findVehicleDetail(vehicleId: string, now: Date): Promise<VehicleDetail | undefined>
}

export interface ThreadRepository {
  findAll(
    ctx: CallerContext,
  ): Promise<Array<Thread & { participants: ThreadParticipant[]; lastMessage: Message | null }>>
  findById(
    ctx: CallerContext,
    id: string,
  ): Promise<(Thread & { participants: ThreadParticipant[]; messages: Message[] }) | undefined>
  findByIdempotencyKey(key: string): Promise<Thread | undefined>
  create(
    ctx: CallerContext,
    bookingId: string | null,
    participantIds: string[],
    idempotencyKey?: string | null,
  ): Promise<Thread>
  markAsRead(ctx: CallerContext, threadId: string): Promise<void>
}

export interface MessageRepository {
  /**
   * Find a message by id, scoped to the caller. Non-privileged callers
   * only see messages in threads they participate in; others get
   * `undefined`. Privileged roles (STAFF/ADMIN) bypass the scope.
   */
  findById(ctx: CallerContext, id: string): Promise<Message | undefined>
  findByIdempotencyKey(key: string): Promise<Message | undefined>
  create(
    ctx: CallerContext,
    threadId: string,
    content: string,
    idempotencyKey?: string | null,
  ): Promise<Message>
  findByThreadId(ctx: CallerContext, threadId: string): Promise<Message[]>
  /**
   * Merge a single language translation into the message's `translations`
   * JSON map. If `detectedSourceLanguage` is provided, also update the
   * message's `sourceLanguage` column (used when the original language
   * was unknown at send time and the provider auto-detected it).
   */
  updateTranslation(
    messageId: string,
    language: string,
    translatedText: string,
    detectedSourceLanguage: string | null,
  ): Promise<Message | undefined>
}

// Transaction boundary for operations spanning multiple repositories.
// Drizzle: wraps db.transaction(), creating repos bound to the tx handle.
// InMemory: passes repos through (JS event loop is single-threaded).
export type RunInTransaction = <T>(
  fn: (repos: {
    vehicleRepo: VehicleRepository
    maintenanceLogRepo: MaintenanceLogRepository
  }) => Promise<T>,
) => Promise<T>

export interface TransitionLogsResult {
  resolved?: MaintenanceLog
  created?: MaintenanceLog
}

export interface MaintenanceLogRepository {
  findByVehicleId(vehicleId: string): Promise<MaintenanceLog[]>
  findActiveByVehicleId(vehicleId: string): Promise<MaintenanceLog | undefined>
  create(data: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaintenanceLog>
  resolve(id: string, resolvedAt: Date): Promise<MaintenanceLog | undefined>
  transitionLogs(
    vehicleId: string,
    resolvedAt: Date,
    newLogData?: Omit<MaintenanceLog, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TransitionLogsResult>
}

export interface VehicleClassFilters {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
}

export interface VehicleClassRepository {
  findAll(filters?: VehicleClassFilters): Promise<VehicleClass[]>
  findById(id: string): Promise<VehicleClass | undefined>
  findBySlug(slug: string): Promise<VehicleClass | undefined>
  create(data: Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleClass>
  update(id: string, data: Partial<VehicleClass>): Promise<VehicleClass | undefined>
  archive(id: string): Promise<VehicleClass | undefined>
}

export interface PhotoStorage {
  put(vehicleId: string, file: File): Promise<{ key: string; url: string }>
  /** Accepts either a key or full URL — implementations strip the base URL prefix. */
  delete(keyOrUrl: string): Promise<void>
}
