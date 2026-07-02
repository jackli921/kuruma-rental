import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
import {
  assignVehicleSchema,
  cancelBookingSchema,
  createBookingSchema,
  substituteVehicleSchema,
  updateBookingStatusSchema,
} from '@kuruma/shared/validators/booking'
import { Hono } from 'hono'
import {
  MANAGEMENT_READ_ROLES,
  isOperatorRole,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { BookingService } from '../services/booking'
import type { ConsentGateService } from '../services/consent-gate'
import type { BookingFilters } from '../services/filters'
import { fail, ok, parseBody, parseDateRange, parseId, parseLimit } from './helpers'

export function createBookingRoutes(service: BookingService, consentGate: ConsentGateService) {
  return new Hono()
    .get('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const statusFilter = c.req.query('status')
      const vehicleIdFilter = c.req.query('vehicleId')
      const renterIdFilter = c.req.query('renterId')
      // `expand` is a comma list (e.g. `vehicle,renter`); a single token still works.
      const expand = new Set(
        (c.req.query('expand') ?? '')
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean),
      )
      const cursor = c.req.query('cursor')

      const dateRange = parseDateRange(c, false)
      if (!dateRange.ok) return dateRange.response

      const pg = parseLimit(c, { defaultLimit: 20 })
      if (!pg.ok) return pg.response
      const { limit } = pg

      const filters: BookingFilters = { limit }
      if (cursor) filters.cursor = cursor
      if (statusFilter) filters.status = statusFilter
      if (vehicleIdFilter) filters.vehicleId = vehicleIdFilter
      if (renterIdFilter) filters.renterId = renterIdFilter
      if (dateRange.from && dateRange.to) {
        filters.from = dateRange.from
        filters.to = dateRange.to
      }
      if (c.req.query('needsAssignment') === 'true') filters.needsAssignment = true

      // #1230 slice 5a: a picker admin may narrow to one operator via ?operatorId=.
      // The raw param is passed through; the service clamps it via bookingReadScope
      // so a non-bypass caller's id is dropped and can never widen (H2). Ownership
      // scoping otherwise stays in the repository layer via CallerContext.
      const requestedOperatorId = c.req.query('operatorId')

      if (expand.has('vehicle') && expand.has('renter')) {
        const result = await service.findAllWithVehiclesAndRentersPaginated(
          ctx,
          filters,
          requestedOperatorId,
        )
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      if (expand.has('vehicle')) {
        const result = await service.findAllWithVehiclesPaginated(ctx, filters, requestedOperatorId)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      if (expand.has('renter')) {
        const result = await service.findAllWithRentersPaginated(ctx, filters, requestedOperatorId)
        return ok(c, result.data, 200, { nextCursor: result.nextCursor })
      }

      const result = await service.findAllPaginated(ctx, filters, requestedOperatorId)
      return ok(c, result.data, 200, { nextCursor: result.nextCursor })
    })
    .get('/bookings/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const { id } = idResult

      // Mirror the list endpoint's `expand` parsing. A deep-linked trip-detail
      // page (#549) has no list-row data, so it requests `vehicle,renter` to
      // carry the assigned car + renter; the operator projection is preserved.
      const expand = new Set(
        (c.req.query('expand') ?? '')
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean),
      )

      const booking =
        expand.has('vehicle') && expand.has('renter')
          ? await service.findByIdWithVehicleAndRenter(ctx, id)
          : await service.findById(ctx, id)
      if (!booking) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, booking)
    })
    .get('/bookings/:id/events', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // §549: operator/management-only. The lifecycle log exposes actorId,
      // internal vehicle ids and the substitution reason; no renter UI consumes
      // a timeline today, so renters are rejected here (403) rather than served a
      // sanitized projection. Cross-tenant reads still 404 at the service.
      // authz model: docs/architecture/booking-authz.md
      if (!MANAGEMENT_READ_ROLES.has(ctx.role)) {
        return fail(c, 'Only operators can view booking events', 403)
      }

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const events = await service.findEvents(ctx, idResult.id)
      if (!events) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, events)
    })
    .get('/bookings/:id/substitution-candidates', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // §A: operator-only, mirroring the substitute route. Renters never browse
      // the fleet (403); a foreign/missing booking 404s at the service (no leak).
      // authz model: docs/architecture/booking-authz.md (feeder-read inherits its write's gate)
      if (!isOperatorRole(ctx.role)) {
        return fail(c, 'Only operators can view substitution candidates', 403)
      }

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const candidates = await service.findSubstitutionCandidates(ctx, idResult.id)
      if (!candidates) {
        return fail(c, 'Booking not found', 404)
      }

      return ok(c, candidates)
    })
    .post('/bookings', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const parsed = await parseBody(c, createBookingSchema)
      if (!parsed.ok) return parsed.response

      // #1108 (audit M4): actor resolution — who may book on behalf of whom and
      // force source=MANUAL — is domain authz and now lives in the service
      // (resolveBookingActor, called by BookingCreationService.create). The route
      // forwards parsed.data untouched. It may still REJECT on role below (the
      // disclaimer + consent gates); it no longer REWRITES the payload by role.

      // #613: a renter self-serve booking must accept the liability disclaimer
      // (免责声明) at checkout — the IDP/license must be valid at pickup or the
      // order is non-refundable (replaces the dropped online document upload).
      // Staff/manual bookings capture acknowledgement operationally and are exempt.
      // The service stamps disclaimerAcknowledgedAt + the terms version on the row.
      if (ctx.role === 'RENTER' && !parsed.data.disclaimerAccepted) {
        return fail(c, 'Liability disclaimer must be accepted', 400, {
          code: 'CONSENT_REQUIRED' satisfies ErrorCode,
        })
      }

      // #877 Flow A: a renter self-serve booking also requires the renter to be
      // current on the platform ToS + privacy policy (once-per-subject, via the
      // consent ledger). The unskippable backstop behind the web clickwrap — a
      // direct/3rd-party caller can't bypass it. The gate is asked UNCONDITIONALLY:
      // the role→required-types map in the consent service is the single source of
      // who is subject, so manual bookers (staff/operator) and api-key partners
      // resolve to zero required types and pass through for free (no I/O) — no
      // second `role === 'RENTER'` list here to drift from it (#1036 M1b). The 403
      // carries `missing[]` so the client knows which documents to present.
      const gate = await consentGate.assertSubjectCurrent(ctx.userId, ctx.role, new Date())
      if (!gate.allowed) {
        return fail(c, 'Consent required', gate.status, {
          code: gate.code satisfies ErrorCode,
          missing: gate.missing,
        })
      }

      // #464 2d.4: forward the parsed discriminator to the service. Common
      // fields are shared; the SPECIFIC member carries requestedVehicleId and
      // the CLASS_COMBO member carries classId (validator narrowed each).
      const commonInput = {
        pickupLocationId: parsed.data.pickupLocationId,
        dropoffLocationId: parsed.data.dropoffLocationId,
        insuranceOptionId: parsed.data.insuranceOptionId ?? null,
        addOnIds: parsed.data.addOnIds,
        // #1108: forward identity fields RAW — resolveBookingActor (service-side)
        // derives the concrete renterId / source / walk-in from the caller role.
        // Omit absent optionals (exactOptionalPropertyTypes).
        ...(parsed.data.renterId ? { renterId: parsed.data.renterId } : {}),
        ...(parsed.data.walkInCustomer ? { walkInCustomer: parsed.data.walkInCustomer } : {}),
        startAt: new Date(parsed.data.startAt),
        endAt: new Date(parsed.data.endAt),
        source: parsed.data.source,
        externalId: parsed.data.externalId ?? null,
        notes: parsed.data.notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey ?? null,
        disclaimerAccepted: parsed.data.disclaimerAccepted ?? false,
      }
      const createResult = await service.create(
        ctx,
        parsed.data.fulfillmentMode === 'CLASS_COMBO'
          ? { ...commonInput, fulfillmentMode: 'CLASS_COMBO', classId: parsed.data.classId }
          : {
              ...commonInput,
              fulfillmentMode: 'SPECIFIC',
              requestedVehicleId: parsed.data.requestedVehicleId,
            },
      )

      if (!createResult.ok) {
        return fail(c, createResult.error, createResult.status, {
          ...(createResult.code ? { code: createResult.code } : {}),
          ...(createResult.details ? { details: createResult.details } : {}),
        })
      }

      return ok(c, createResult.booking, createResult.status ?? 201)
    })
    .patch('/bookings/:id/status', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // #643: status transitions (CONFIRMED -> ACTIVE -> COMPLETED) are physical
      // pickup/return events driven by the operator, not the renter. Row-scoping
      // alone would let a renter self-advance their own booking via the raw API,
      // skewing operator dashboards and any settlement keyed off status. Gate on
      // management roles (operators + staff/admin); renter self-cancel stays open
      // on /cancel by design (tiered cancellation is a renter-facing feature).
      // authz model: docs/architecture/booking-authz.md
      if (!MANAGEMENT_READ_ROLES.has(ctx.role)) {
        return fail(c, 'Only operators can update booking status', 403)
      }

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateBookingStatusSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.updateStatus(ctx, idResult.id, parsed.data.status)
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking)
    })
    .post('/bookings/:id/cancel', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      // #868 3b: the renter may attach an OPTIONAL cancellation reason. The body
      // can be absent entirely — the operator cancel client sends none, and a
      // renter who picks no reason sends `{}` — so allowEmpty treats a missing
      // body as "no reason"; a present-but-malformed reason is still a 400. The
      // reason never blocks the cancel itself.
      const parsed = await parseBody(c, cancelBookingSchema, { allowEmpty: true })
      if (!parsed.ok) return parsed.response

      const reason = parsed.data.reason
        ? { code: parsed.data.reason.code, note: parsed.data.reason.note || null }
        : null

      const result = await service.cancel(ctx, idResult.id, reason)
      if (!result.ok) {
        return fail(c, result.error, result.status)
      }

      return ok(c, result.booking, 200, { cancellation: result.cancellation })
    })
    .post('/bookings/:id/substitute', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // §5.5: substitution is operator-only. Renters never reassign their own
      // vehicle (403). Cross-operator bookings 404 at the service (no leak).
      // authz model: docs/architecture/booking-authz.md (deliberately stricter than /status)
      if (!isOperatorRole(ctx.role)) {
        return fail(c, 'Only operators can substitute a vehicle', 403)
      }

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, substituteVehicleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.substitute(
        ctx,
        idResult.id,
        parsed.data.newVehicleId,
        parsed.data.reason ?? null,
      )
      if (!result.ok) {
        return fail(c, result.error, result.status, {
          ...(result.code ? { code: result.code } : {}),
        })
      }

      return ok(c, result.booking)
    })
    .post('/bookings/:id/assign', async (c) => {
      const ctx = toCallerContext(requireUser(c))

      // #464: assigning a car to a CLASS_COMBO float is operator-only (fleet
      // ownership decision, mirrors substitute's gate).
      if (!isOperatorRole(ctx.role)) {
        return fail(c, 'Only operators can assign a vehicle', 403)
      }

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, assignVehicleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.assignVehicle(
        ctx,
        idResult.id,
        parsed.data.vehicleId,
        parsed.data.reason ?? null,
      )
      if (!result.ok) {
        return fail(c, result.error, result.status, {
          ...(result.code ? { code: result.code } : {}),
        })
      }

      return ok(c, result.booking)
    })
}
