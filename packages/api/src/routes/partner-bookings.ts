import { createPartnerBookingSchema } from '@kuruma/shared/validators/partner-booking'
import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { PartnerBookingService } from '../services/partner-booking'
import { fail, ok, parseBody } from './helpers'

/**
 * 3rd-party booking API (Phase 3a). Used by OTA partners like Trip.com.
 * Requires an X-API-Key header (verified by `requireAuth` middleware).
 * Callers arrive with role=PARTNER; the service forces source to one
 * of the allowed partner enums and auto-upserts the renter by email.
 */
export function createPartnerBookingRoutes(service: PartnerBookingService) {
  return new Hono().post('/external/bookings', async (c) => {
    const user = requireUser(c)
    if (user.role !== 'PARTNER') {
      return fail(c, 'Forbidden: partner API key required', 403)
    }

    const ctx = toCallerContext(user)
    const parsed = await parseBody(c, createPartnerBookingSchema)
    if (!parsed.ok) return parsed.response

    const result = await service.create(ctx, {
      vehicleId: parsed.data.vehicleId,
      renterEmail: parsed.data.renterEmail,
      renterName: parsed.data.renterName,
      renterPhone: parsed.data.renterPhone ?? null,
      renterLanguage: parsed.data.renterLanguage,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      source: parsed.data.source,
      externalId: parsed.data.externalId,
      notes: parsed.data.notes ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
    })

    if (!result.ok) {
      return fail(c, result.error, result.status, {
        ...(result.code ? { code: result.code } : {}),
        ...(result.details ? { details: result.details } : {}),
      })
    }

    return ok(c, result.booking, result.status ?? 201)
  })
}
