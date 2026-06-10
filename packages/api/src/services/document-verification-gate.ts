import type { BookingVerificationGate } from './booking'
import type { RenterDocumentService } from './renter-document'

/**
 * Build the booking verification gate (#459) from the document service. Bridges
 * the document domain (`isRenterEligible`) to BookingService's injected gate
 * seam, mapping an ineligible verdict to the 403 the booking route surfaces
 * verbatim. Wired in the composition root only when the flag is on.
 */
export function documentVerificationGate(service: RenterDocumentService): BookingVerificationGate {
  return async (_ctx, input) => {
    const verdict = await service.isRenterEligible(input.renterId, input.endAt)
    if (verdict.ok) return { ok: true }
    return {
      ok: false,
      status: 403,
      error:
        'An approved International Driving Permit valid through your return date is required to book.',
      code: 'DOCUMENT_VERIFICATION_REQUIRED',
    }
  }
}
