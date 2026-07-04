import type { ReviewListCursor, ReviewRepository } from '../repositories/types'
import type { Review } from '../stores'
import { encodeReviewCursor } from './review-cursor'

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

/** One page of the review list plus the keyset cursor for the next one (#1449). */
export interface ReviewPage {
  readonly reviews: PublicReview[]
  /** Opaque token to pass as the next `after`, or null when this is the last page. */
  readonly nextCursor: string | null
}

/** Page size for the public review list. Mirrors the search page size so a busy
 *  operator's list stays bounded; "load more" (#1449) pages past it via the cursor. */
export const MAX_REVIEW_LIST = 20

export class ReviewListService {
  constructor(private readonly reviewRepo: ReviewRepository) {}

  forOperator(operatorId: string, after?: ReviewListCursor): Promise<ReviewPage> {
    return this.list('OPERATOR', operatorId, after)
  }

  forVehicle(vehicleId: string, after?: ReviewListCursor): Promise<ReviewPage> {
    return this.list('VEHICLE', vehicleId, after)
  }

  private async list(
    subject: 'OPERATOR' | 'VEHICLE',
    subjectId: string,
    after?: ReviewListCursor,
  ): Promise<ReviewPage> {
    // Probe ONE past the page size: if the repo returns MAX + 1 rows there is another
    // page, and the extra row is dropped — cheaper than a separate COUNT.
    const rows = await this.reviewRepo.listPublishedForSubject(
      subject,
      subjectId,
      MAX_REVIEW_LIST + 1,
      after,
    )
    const hasMore = rows.length > MAX_REVIEW_LIST
    const page = hasMore ? rows.slice(0, MAX_REVIEW_LIST) : rows
    const reviews = page.map(toPublicReview)
    const last = page.at(-1)
    // The keyset cursor is only meaningful when a further page exists. `last.publishedAt`
    // is non-null (toPublicReview above would have thrown otherwise), but guard for the type.
    const nextCursor =
      hasMore && last?.publishedAt
        ? encodeReviewCursor({ publishedAt: last.publishedAt, id: last.id })
        : null
    return { reviews, nextCursor }
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
