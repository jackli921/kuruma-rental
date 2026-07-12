import type { AddOnSnapshot, InsuranceSnapshot } from '@kuruma/shared/db/schema'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import type { TransactionRepos } from '../repositories/types'
import type { ConsentDocument } from '../stores'
import { composeBookingTotal, rentalDays } from './booking-pricing-helpers'
import type { CreateBookingInput, CreateBookingResult } from './booking-types'
import { buildAcceptanceRow } from './consent-acceptance-row'
import type { SigningKey } from './consent-signing'
import { resolveOperatorTermsDecision } from './operator-terms-acceptance'

// #613: version of the liability-disclaimer (免责声明) wording a renter agreed to,
// stamped onto the booking. Bump when the localized terms text changes materially
// (the renter-facing copy lives in web i18n; this is the server-authoritative tag).
export const DISCLAIMER_TERMS_VERSION = '2026-06-13'

/**
 * #877 Slice B threading context: whether this create must seal an operator-terms
 * acceptance, plus the signing key resolved OUTSIDE the tx (H3 fail-fast). Threaded
 * as one object through submitInTx → the locked variants → snapshotAndInsert so the
 * per-mode signatures stay cohesive rather than growing two loose parameters.
 */
export interface OperatorTermsTxContext {
  active: boolean
  signingKey: SigningKey | undefined
}

/**
 * #1109 (audit M1): the snapshot+insert tail shared by SPECIFIC and CLASS_COMBO.
 * Both modes resolve insurance / fees / add-ons against the same operator-scoped
 * reads, compose the same total, mint the walk-in renter (#875) past the last
 * validation `return`, then INSERT-then-EVENT-append in tx order so a constraint
 * failure rolls back atomically (no orphan event). The mode-specific bits —
 * basePriceJpy and the three discriminator fields (fulfillmentMode,
 * assignedVehicleId, requestedVehicleId) — are passed in. Split out of
 * BookingCreationService (which owns validation + the fulfillment-mode decision) so
 * that god-file stays under the size cap; parity is pinned by booking.test.ts
 * (SPECIFIC vs CLASS_COMBO snapshot equality).
 */
export async function snapshotAndInsert(
  ctx: CallerContext,
  repos: TransactionRepos,
  args: {
    input: CreateBookingInput
    operatorId: string
    classId: string
    basePriceJpy: number
    fulfillmentMode: 'SPECIFIC' | 'CLASS_COMBO'
    assignedVehicleId: string | null
    requestedVehicleId: string | null
    effectiveEndAt: Date
    // Non-walk-in: the existing renter / self resolved in `create`. Walk-in
    // (#875): null — the fresh renter is minted below, inside this tx, past
    // every validation `return`.
    renterId: string | null
    now: Date
    // #877 Slice B: whether + how to seal the operator-terms acceptance (see create).
    operatorTerms: OperatorTermsTxContext
    // Injected so the collision-retry path stays deterministically testable (the
    // owning service holds the seam; this tail just calls it once per attempt).
    generateCode: () => string
  },
): Promise<CreateBookingResult> {
  const {
    input,
    operatorId,
    classId,
    basePriceJpy,
    fulfillmentMode,
    assignedVehicleId,
    requestedVehicleId,
    effectiveEndAt,
    renterId,
    now,
    operatorTerms,
    generateCode,
  } = args

  // Selected insurance: snapshot the chosen ACTIVE option from THIS operator.
  let insuranceOptionId: string | null = null
  let insuranceSnapshot: InsuranceSnapshot | null = null
  if (input.insuranceOptionId) {
    const opt = await repos.insuranceOptionRepo.findById(SYSTEM_CONTEXT, input.insuranceOptionId)
    if (!opt || opt.operatorId !== operatorId || opt.status !== 'ACTIVE') {
      return { ok: false, status: 400, error: 'Insurance option is not available' }
    }
    insuranceOptionId = opt.id
    insuranceSnapshot = {
      insuranceOptionId: opt.id,
      name: opt.name,
      dailyPriceJpy: opt.dailyPriceJpy,
      deductibleJpy: opt.deductibleJpy,
    }
  }

  // Fee snapshot: this operator's ACTIVE fees that are operator-wide or match
  // the booking's class. Locks the rate at booking time (§6.2, informational).
  const fees = await repos.feeScheduleRepo.findAll(SYSTEM_CONTEXT, {
    operatorId,
    status: 'ACTIVE',
  })
  const feeSnapshot = fees
    .filter((f) => f.vehicleClassId === null || f.vehicleClassId === classId)
    .map((f) => ({
      feeType: f.feeType,
      unit: f.unit,
      amountJpy: f.amountJpy,
      vehicleClassId: f.vehicleClassId,
    }))

  // Selected paid add-ons (#460): each flat priceJpy is snapshotted here and
  // folded into the total below via composeBookingTotal. One ACTIVE-only,
  // this-operator read validates membership + tenant + active in a single
  // query (a foreign/archived id is simply absent -> 400). De-dup so a
  // repeated id is charged once (quantity is out of MVP).
  const addOnSnapshot: AddOnSnapshot[] = []
  if (input.addOnIds.length > 0) {
    const available = await repos.addOnRepo.findActiveByOperator(operatorId)
    const availableById = new Map(available.map((a) => [a.id, a]))
    for (const addOnId of new Set(input.addOnIds)) {
      const addOn = availableById.get(addOnId)
      if (!addOn) return { ok: false, status: 400, error: 'Add-on is not available' }
      addOnSnapshot.push({ addOnId: addOn.id, name: addOn.name, priceJpy: addOn.priceJpy })
    }
  }

  // One composition for create AND substitute() — never hand-summed twice (#862).
  const totalPrice = composeBookingTotal({
    baseJpy: basePriceJpy,
    insurancePerDayJpy: insuranceSnapshot?.dailyPriceJpy ?? 0,
    days: rentalDays(input.startAt, input.endAt),
    addOns: addOnSnapshot,
  })

  const bookingCode = generateCode()

  // #877 Slice B: resolve + pin-check the operator's rental terms BEFORE any side
  // effect (esp. the walk-in mint below): `required`/`changed` return 422 with
  // nothing minted or inserted — a `return` here would COMMIT the tx. Skipped
  // unless active (RENTER self-serve + OPERATOR_TERMS on + the operator has
  // published effective terms), so every other path never touches consentRepo. The
  // exact pinned version is signed — resolving "latest" instead would seal text the
  // renter never saw (C1 TOCTOU); a stale pin is a re-consent prompt, not a swap.
  let operatorTermsDoc: ConsentDocument | undefined
  if (operatorTerms.active) {
    const latest = await repos.consentRepo.findLatestPublishedVersionForOperator(
      operatorId,
      'OPERATOR_RENTAL_TERMS',
      now,
    )
    const locale = input.locale ?? 'en'
    const doc = latest
      ? ((await repos.consentRepo.findPublishedOperatorDocument(
          operatorId,
          'OPERATOR_RENTAL_TERMS',
          latest,
          locale,
        )) ??
        (await repos.consentRepo.findPublishedOperatorDocument(
          operatorId,
          'OPERATOR_RENTAL_TERMS',
          latest,
          'en',
        )))
      : undefined
    // `en` is a REQUIRED base locale at save (saveOperatorTermsDraftSchema), so a
    // published version always resolves via the en fallback. If it ever does not
    // (e.g. a raw DB write bypassing the validator), fail CLOSED loudly rather than
    // silently booking with no consent recorded — the resolver would otherwise skip.
    if (latest && !doc) {
      throw new Error(
        `operator ${operatorId} published OPERATOR_RENTAL_TERMS ${latest} with no resolvable document`,
      )
    }
    const decision = resolveOperatorTermsDecision({
      role: ctx.role,
      latest,
      doc,
      accepted: input.operatorRentalTermsAccepted ?? false,
      pinned: input.operatorRentalTermsAcceptedVersion,
    })
    if (decision.kind === 'required') {
      return {
        ok: false,
        status: 422,
        error: 'Operator rental terms must be accepted',
        code: 'OPERATOR_TERMS_REQUIRED',
      }
    }
    if (decision.kind === 'changed') {
      return {
        ok: false,
        status: 422,
        error: 'Operator rental terms changed; please review and re-accept',
        code: 'OPERATOR_TERMS_CHANGED',
      }
    }
    if (decision.kind === 'accept') operatorTermsDoc = decision.doc
  }

  // #875: mint the walk-in renter HERE — past every validation `return` above
  // (a return COMMITS the tx, so an earlier insert would orphan on a 400),
  // and right before the booking insert whose 409 / booking_code-collision
  // THROW rolls this back with it. Atomic: a failed attempt leaves no orphan
  // customer.
  const bookingRenterId = input.walkInCustomer
    ? (await repos.userRepo.createWalkInRenter(input.walkInCustomer)).id
    : renterId
  if (bookingRenterId === null) {
    // Invariant: a non-walk-in booking always resolves renterId in `create`.
    throw new Error('booking submit: renterId unresolved (non-walk-in)')
  }

  // Insert FIRST: the exclusion / unique constraints fire here, BEFORE the
  // event append, so a rolled-back insert leaves no orphan event (atomicity).
  const booking = await repos.bookingRepo.create(ctx, {
    operatorId,
    renterId: bookingRenterId,
    classId,
    requestedVehicleId,
    assignedVehicleId,
    pickupLocationId: input.pickupLocationId,
    dropoffLocationId: input.dropoffLocationId,
    startAt: input.startAt,
    endAt: input.endAt,
    effectiveEndAt,
    status: 'CONFIRMED',
    source: input.source,
    // #463: server-derived discriminator (SPECIFIC at MVP, CLASS_COMBO #464).
    fulfillmentMode,
    bookingCode,
    insuranceOptionId,
    insuranceSnapshot,
    feeSnapshot,
    addOnSnapshot,
    externalId: input.externalId ?? null,
    notes: input.notes ?? null,
    totalPrice,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: input.idempotencyKey ?? null,
    // #613: stamp the liability-disclaimer consent server-side (never trust a
    // client timestamp). Set only when the renter accepted; null for staff/
    // manual bookings (the route exempts non-renter callers from the gate).
    disclaimerAcknowledgedAt: input.disclaimerAccepted ? now : null,
    disclaimerTermsVersion: input.disclaimerAccepted ? DISCLAIMER_TERMS_VERSION : null,
  })

  await repos.bookingEventRepo.append(ctx, {
    bookingId: booking.id,
    type: 'BOOKING_CREATED',
    // The actor is who PERFORMED the booking (the authed caller), not the
    // subject: a staff/manual booking records the staff member, not the
    // customer. The renter lives in the booking row + payload. Mirrors
    // VEHICLE_SUBSTITUTED, which also uses ctx.userId.
    actorId: ctx.userId,
    payload: {
      type: 'BOOKING_CREATED',
      requestedVehicleId,
      assignedVehicleId,
      classId,
      fulfillmentMode, // #463: mirror the booking's discriminator in the audit snapshot
      startAt: input.startAt.toISOString(),
      endAt: input.endAt.toISOString(),
      totalPrice,
      insuranceSnapshot,
      feeSnapshot,
      addOnSnapshot,
    },
  })

  // #877 Slice B: seal the acceptance AFTER the insert — the fresh booking.id is a
  // signed field, so the row can't be built until the booking exists. Same tx, so a
  // later failure rolls both back together; the (bookingId, consentType) unique seal
  // is the idempotency backstop. operatorId is NULL (the renter accepts the operator's
  // doc, they don't author it) and method is CLICKWRAP (a checkout tick, not e-sign).
  if (operatorTermsDoc) {
    await repos.consentRepo.createAcceptance(
      buildAcceptanceRow(
        operatorTermsDoc,
        {
          userId: bookingRenterId,
          operatorId: null,
          operatorMembershipId: null,
          actorRole: ctx.role,
          bookingId: booking.id,
          method: 'CLICKWRAP',
          acceptedAt: now,
          ipAddress: null,
          userAgent: null,
        },
        operatorTerms.signingKey,
      ),
    )
  }

  return { ok: true, booking }
}
