import {
  bulkUpdateVehicleStatusSchema,
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusWithReasonSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import { PG_ERROR, pgErrorCode } from '../pg-errors'
import type { Vehicle, VehicleFilters, VehicleRepository } from '../repositories/types'
import type { MaintenanceService } from '../services/maintenance'
import type { ResolveWriteOperatorId } from '../tenancy'
import { fail, ok, parseBody, parsePagination, stripUndefined } from './helpers'

export function createVehicleRoutes(
  repo: VehicleRepository,
  maintenanceService: MaintenanceService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  return new Hono()
    .get('/vehicles', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const status = c.req.query('status')
      const pg = parsePagination(c, { defaultLimit: 50 })
      if (!pg.ok) return pg.response
      const { limit, offset } = pg

      const filters: VehicleFilters = { limit, offset, ...(status ? { status } : {}) }
      const { data, total } = await repo.findAll(ctx, filters)
      return ok(c, data, 200, { total, limit, offset })
    })
    .get('/vehicles/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const vehicle = await repo.findById(ctx, c.req.param('id'))
      if (!vehicle) {
        return fail(c, 'Vehicle not found', 404)
      }
      return ok(c, vehicle)
    })
    .post('/vehicles', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const parsed = await parseBody(c, createVehicleSchema)
      if (!parsed.ok) return parsed.response

      // Resolve the target tenant before the insert so a missing/ambiguous
      // operatorId (#401) surfaces as 403/422 from the global handler rather
      // than as a caught DB error below.
      const operatorId = await resolveWriteOperatorId(ctx, parsed.data.operatorId)

      try {
        const vehicle = await repo.create(ctx, {
          operatorId,
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
        // #400: the composite FK (operatorId,classId) -> vehicle_classes rejects
        // an unknown or cross-tenant classId at the DB. Surface as 422, not 500.
        if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
          return fail(c, 'Invalid vehicle class', 422)
        }
        throw err
      }
    })
    .patch('/vehicles/bulk-status', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const parsed = await parseBody(c, bulkUpdateVehicleStatusSchema)
      if (!parsed.ok) return parsed.response

      const { vehicleIds, status } = parsed.data
      const uniqueIds = [...new Set(vehicleIds)]

      // Pre-check: all IDs must exist and not be RETIRED.
      const existing = await repo.findByIds(ctx, uniqueIds)
      if (existing.length !== uniqueIds.length) {
        return fail(c, 'One or more vehicles not found', 404)
      }
      const retiredIds = existing.filter((v) => v.status === 'RETIRED').map((v) => v.id)
      if (retiredIds.length > 0) {
        return fail(c, 'Cannot bulk-update retired vehicles', 400)
      }

      const updated = await repo.bulkUpdateStatus(ctx, uniqueIds, status)
      return ok(c, updated)
    })
    .patch('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const existing = await repo.findById(ctx, c.req.param('id'))
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
        const updated = await repo.update(
          ctx,
          existing.id,
          stripUndefined(changes) as Partial<Vehicle>,
        )
        return ok(c, updated)
      } catch (err) {
        if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
          return fail(c, 'License plate already in use', 409)
        }
        // #400: the composite FK (operatorId,classId) -> vehicle_classes rejects
        // an unknown or cross-tenant classId at the DB. Surface as 422, not 500.
        if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
          return fail(c, 'Invalid vehicle class', 422)
        }
        throw err
      }
    })
    .patch('/vehicles/:id/status', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const parsed = await parseBody(c, updateVehicleStatusWithReasonSchema)
      if (!parsed.ok) return parsed.response

      const result = await maintenanceService.toggleStatus(
        ctx,
        c.req.param('id'),
        parsed.data.status,
        parsed.data.reason,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.vehicle)
    })
    .delete('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)
      const ctx = toCallerContext(user)

      const existing = await repo.findById(ctx, c.req.param('id'))
      if (!existing) {
        return fail(c, 'Vehicle not found', 404)
      }

      const retired = await repo.softDelete(ctx, existing.id)
      return ok(c, retired)
    })
}
