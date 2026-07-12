import type { ConsentDocument } from '../stores'

/**
 * The pure decision for whether a booking-create must seal an operator's
 * OPERATOR_RENTAL_TERMS acceptance (#877 Slice B). Split out (FC/IS) from the tx
 * so require/changed/skip is directly unit-tested without a database.
 *
 * - `skip`     — nothing to seal (not a self-serve renter, or the operator has no
 *                published+effective terms). The booking proceeds with no row.
 * - `required` — a published doc exists but the renter did not accept → 422.
 * - `changed`  — the renter pinned a version that is no longer the latest → 422.
 *                Version pins are exact `v1`-style strings; resolving "latest" and
 *                signing it instead would seal text the renter never saw (C1 TOCTOU).
 * - `accept`   — pinned === latest → seal THIS exact doc.
 */
export type OperatorTermsDecision =
  | { kind: 'skip' }
  | { kind: 'required' }
  | { kind: 'changed' }
  | { kind: 'accept'; doc: ConsentDocument }

export function resolveOperatorTermsDecision(p: {
  role: string
  latest: string | undefined
  doc: ConsentDocument | undefined
  accepted: boolean
  pinned: string | undefined
}): OperatorTermsDecision {
  // §9b delta 1: gate on RENTER, NOT source==='DIRECT' — DIRECT over-includes the
  // api-key PARTNER caller. This cleanly excludes walk-in/manual/operator/PARTNER.
  if (p.role !== 'RENTER') return { kind: 'skip' }
  // The operator has not published effective terms for this type → nothing to seal.
  if (!p.latest || !p.doc) return { kind: 'skip' }
  if (!p.accepted) return { kind: 'required' }
  if (p.pinned !== p.latest) return { kind: 'changed' }
  return { kind: 'accept', doc: p.doc }
}
