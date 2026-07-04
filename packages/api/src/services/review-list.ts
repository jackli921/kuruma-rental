import type { ReviewRepository } from '../repositories/types'
import type { Review } from '../stores'

/**
 * Public review-list read service (review-display slice, #1067). Returns the newest
 * published + VISIBLE reviews for one subject, curated to a privacy-safe wire shape.
 * Public — no authz; callers are anonymous storefront pages (mirrors ReviewAggregateService).
 *
 * Only OPERATOR / VEHICLE subjects are listable: an operator's review OF a renter
 * (subject='RENTER') stays private, so this service never exposes one.
 */

/** The public wire shape. Deliberately omits bookingId / authorUserId / operatorId /
 *  moderationStatus / reveal timestamps — a storefront reader needs only the content. */
export interface PublicReview {
  readonly id: string
  readonly overall: number
  readonly subRatings: Record<string, number>
  readonly comment: string | null
  /** ISO 8601 (UTC). Non-null — the repo only returns published rows. */
  readonly publishedAt: string
}

/** Newest-N shown without pagination; "load more" is a follow-up. Mirrors the search
 *  page size so a busy operator's list stays bounded. */
export const MAX_REVIEW_LIST = 20

export class ReviewListService {
  constructor(private readonly reviewRepo: ReviewRepository) {}

  forOperator(operatorId: string): Promise<PublicReview[]> {
    return this.list('OPERATOR', operatorId)
  }

  forVehicle(vehicleId: string): Promise<PublicReview[]> {
    return this.list('VEHICLE', vehicleId)
  }

  private async list(subject: 'OPERATOR' | 'VEHICLE', subjectId: string): Promise<PublicReview[]> {
    const rows = await this.reviewRepo.listPublishedForSubject(subject, subjectId, MAX_REVIEW_LIST)
    return rows.map(toPublicReview)
  }
}

function toPublicReview(r: Review): PublicReview {
  // The repo only returns published rows, so publishedAt is non-null. Assert the
  // invariant loudly rather than inventing a fallback date that would silently corrupt output.
  if (r.publishedAt === null) {
    throw new Error(`invariant: listed review ${r.id} has null publishedAt`)
  }
  return {
    id: r.id,
    overall: r.overall,
    subRatings: { ...r.subRatings },
    comment: r.comment,
    publishedAt: r.publishedAt.toISOString(),
  }
}
