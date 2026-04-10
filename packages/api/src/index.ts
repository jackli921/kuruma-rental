import { getDb } from '@kuruma/shared/db'
import { Hono } from 'hono'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleStatsRepository,
  DrizzleVehicleRepository,
} from './repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryMessageRepository,
  InMemoryStatsRepository,
  InMemoryThreadRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import type {
  AvailabilityRepository,
  BookingRepository,
  MessageRepository,
  StatsRepository,
  ThreadRepository,
  VehicleRepository,
} from './repositories/types'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import health from './routes/health'
import { createMessageRoutes } from './routes/messages'
import { createStatsRoutes } from './routes/stats'
import { createVehicleRoutes } from './routes/vehicles'

export function createApp(overrides?: {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  statsRepo?: StatsRepository
  threadRepo?: ThreadRepository
  messageRepo?: MessageRepository
}) {
  let vehicleRepo: VehicleRepository
  let bookingRepo: BookingRepository
  let availabilityRepo: AvailabilityRepository
  let statsRepo: StatsRepository
  let threadRepo: ThreadRepository
  let messageRepo: MessageRepository

  if (overrides) {
    ;({ vehicleRepo, bookingRepo, availabilityRepo } = overrides)
    statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = overrides.threadRepo ?? new InMemoryThreadRepository()
    messageRepo =
      overrides.messageRepo ?? new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    statsRepo = new DrizzleStatsRepository(db)
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  } else {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo as InMemoryVehicleRepository,
      bookingRepo as InMemoryBookingRepository,
    )
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
    threadRepo = new InMemoryThreadRepository()
    messageRepo = new InMemoryMessageRepository(threadRepo as InMemoryThreadRepository)
  }

  const app = new Hono()
  app.route('/', health)
  app.route('/', createVehicleRoutes(vehicleRepo))
  app.route('/', createBookingRoutes(bookingRepo, vehicleRepo))
  app.route('/', createAvailabilityRoutes(availabilityRepo))
  app.route('/', createStatsRoutes(statsRepo))
  app.route('/', createMessageRoutes(threadRepo, messageRepo))

  return app
}

export default createApp()
