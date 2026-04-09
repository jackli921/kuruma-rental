import { getDb } from '@kuruma/shared/db'
import { Hono } from 'hono'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleRepository,
} from './repositories/drizzle'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryStatsRepository,
  InMemoryVehicleRepository,
} from './repositories/in-memory'
import type {
  AvailabilityRepository,
  BookingRepository,
  StatsRepository,
  VehicleRepository,
} from './repositories/types'
import { createAvailabilityRoutes } from './routes/availability'
import { createBookingRoutes } from './routes/bookings'
import health from './routes/health'
import { createStatsRoutes } from './routes/stats'
import { createVehicleRoutes } from './routes/vehicles'

export function createApp(overrides?: {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  statsRepo?: StatsRepository
}) {
  let vehicleRepo: VehicleRepository
  let bookingRepo: BookingRepository
  let availabilityRepo: AvailabilityRepository
  let statsRepo: StatsRepository

  if (overrides) {
    ;({ vehicleRepo, bookingRepo, availabilityRepo } = overrides)
    statsRepo = overrides.statsRepo ?? new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  } else if (process.env.DATABASE_URL) {
    const db = getDb()
    vehicleRepo = new DrizzleVehicleRepository(db)
    bookingRepo = new DrizzleBookingRepository(db)
    availabilityRepo = new DrizzleAvailabilityRepository(db)
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  } else {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo as InMemoryVehicleRepository,
      bookingRepo as InMemoryBookingRepository,
    )
    statsRepo = new InMemoryStatsRepository(vehicleRepo, bookingRepo)
  }

  const app = new Hono()
  app.route('/', health)
  app.route('/', createVehicleRoutes(vehicleRepo))
  app.route('/', createBookingRoutes(bookingRepo))
  app.route('/', createAvailabilityRoutes(availabilityRepo))
  app.route('/', createStatsRoutes(statsRepo))

  return app
}

export default createApp()
