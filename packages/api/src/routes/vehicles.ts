import {
  bulkUpdateVehicleStatusSchema,
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusWithReasonSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { Vehicle, VehicleFilters, VehicleRepository } from '../repositories/types'
import type { MaintenanceService } from '../services/maintenance'
import { fail, ok, parseBody, stripUndefined } from './helpers'

export function createVehicleRoutes(
  repo: VehicleRepository,
  maintenanceService: MaintenanceService,
) {
  return new Hono()
    .get('/vehicles', async (c) => {
      const status = c.req.query('status')
      const limitParam = c.req.query('limit')
      const offsetParam = c.req.query('offset')

      const limit = limitParam ? Number.parseInt(limitParam, 10) : 50
      if (Number.isNaN(limit) || limit < 1 || limit > 100) {
        return fail(c, 'limit must be between 1 and 100', 400)
      }
      const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0
      if (Number.isNaN(offset) || offset < 0) {
        return fail(c, 'offset must be a non-negative integer', 400)
      }

      const filters: VehicleFilters = { limit, offset, ...(status ? { status } : {}) }
      const { data, total } = await repo.findAll(filters)
      return ok(c, data, 200, { total, limit, offset })
    })
    .get('/vehicles/:id', async (c) => {
      const vehicle = await repo.findById(c.req.param('id'))
      if (!vehicle) {
        return fail(c, 'Vehicle not found', 404)
      }
      return ok(c, vehicle)
    })
    .post('/vehicles', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const parsed = await parseBody(c, createVehicleSchema)
      if (!parsed.ok) return parsed.response

      try {
        const vehicle = await repo.create({
          classId: parsed.data.classId ?? null,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          photos: parsed.data.photos,
          seats: parsed.data.seats,
          transmission: parsed.data.transmission,
          fuelType: parsed.data.fuelType ?? null,
          licensePlate: parsed.data.licensePlate ?? null,
          status: 'AVAILABLE',
          bufferMinutes: parsed.data.bufferMinutes,
          minRentalHours: parsed.data.minRentalHours ?? null,
          maxRentalHours: parsed.data.maxRentalHours ?? null,
          advanceBookingHours: parsed.data.advanceBookingHours ?? null,
          make: parsed.data.make ?? null,
          model: parsed.data.model ?? null,
          year: parsed.data.year ?? null,
          color: parsed.data.color ?? null,
          dailyRateJpy: parsed.data.dailyRateJpy ?? null,
          hourlyRateJpy: parsed.data.hourlyRateJpy ?? null,
          shakenExpiryDate: parsed.data.shakenExpiryDate ?? null,
          insuranceExpiryDate: parsed.data.insuranceExpiryDate ?? null,
        })

        return ok(c, vehicle, 201)
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          return fail(c, 'License plate already in use', 409)
        }
        throw err
      }
    })
    .patch('/vehicles/bulk-status', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const parsed = await parseBody(c, bulkUpdateVehicleStatusSchema)
      if (!parsed.ok) return parsed.response

      const { vehicleIds, status } = parsed.data
      const uniqueIds = [...new Set(vehicleIds)]

      // Pre-check: all IDs must exist and not be RETIRED.
      const existing = await repo.findByIds(uniqueIds)
      if (existing.length !== uniqueIds.length) {
        return fail(c, 'One or more vehicles not found', 404)
      }
      const retiredIds = existing.filter((v) => v.status === 'RETIRED').map((v) => v.id)
      if (retiredIds.length > 0) {
        return fail(c, 'Cannot bulk-update retired vehicles', 400)
      }

      const updated = await repo.bulkUpdateStatus(uniqueIds, status)
      return ok(c, updated)
    })
    .patch('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const existing = await repo.findById(c.req.param('id'))
      if (!existing) {
        return fail(c, 'Vehicle not found', 404)
      }

      const parsed = await parseBody(c, updateVehicleSchema)
      if (!parsed.ok) return parsed.response

      // Merge patch with existing: use patch value if key was sent (even null),
      // otherwise keep existing. `??` would swallow explicit nulls.
      const d = parsed.data
      const merge = <T>(key: string, fallback: T): T =>
        key in d ? ((d as Record<string, unknown>)[key] as T) : fallback

      const changes = {
        ...d,
        classId: merge('classId', existing.classId),
        description: merge('description', existing.description),
        fuelType: merge('fuelType', existing.fuelType),
        licensePlate: merge('licensePlate', existing.licensePlate),
        minRentalHours: merge('minRentalHours', existing.minRentalHours),
        maxRentalHours: merge('maxRentalHours', existing.maxRentalHours),
        advanceBookingHours: merge('advanceBookingHours', existing.advanceBookingHours),
        make: merge('make', existing.make),
        model: merge('model', existing.model),
        year: merge('year', existing.year),
        color: merge('color', existing.color),
        dailyRateJpy: merge('dailyRateJpy', existing.dailyRateJpy),
        hourlyRateJpy: merge('hourlyRateJpy', existing.hourlyRateJpy),
        shakenExpiryDate: merge('shakenExpiryDate', existing.shakenExpiryDate),
        insuranceExpiryDate: merge('insuranceExpiryDate', existing.insuranceExpiryDate),
      }

      if (changes.dailyRateJpy == null && changes.hourlyRateJpy == null) {
        return fail(c, 'At least one rate (daily or hourly) is required', 400)
      }

      const mergedMin = changes.minRentalHours
      const mergedMax = changes.maxRentalHours
      if (mergedMin != null && mergedMax != null && mergedMin > mergedMax) {
        return fail(
          c,
          { maxRentalHours: ['Maximum rental hours must be greater than or equal to minimum'] },
          400,
        )
      }

      try {
        const updated = await repo.update(existing.id, stripUndefined(changes) as Partial<Vehicle>)
        return ok(c, updated)
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          return fail(c, 'License plate already in use', 409)
        }
        throw err
      }
    })
    .patch('/vehicles/:id/status', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const parsed = await parseBody(c, updateVehicleStatusWithReasonSchema)
      if (!parsed.ok) return parsed.response

      const result = await maintenanceService.toggleStatus(
        c.req.param('id'),
        parsed.data.status,
        parsed.data.reason,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.vehicle)
    })
    .delete('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const existing = await repo.findById(c.req.param('id'))
      if (!existing) {
        return fail(c, 'Vehicle not found', 404)
      }

      const retired = await repo.softDelete(existing.id)
      return ok(c, retired)
    })
}
