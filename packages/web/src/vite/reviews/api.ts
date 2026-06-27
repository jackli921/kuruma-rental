import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  REVIEW_AUTHOR_ROLES,
  REVIEW_SUBJECTS,
  type ReviewAuthorRole,
  type ReviewSubject,
} from '@kuruma/shared/enums'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #1083: the two subjects a renter rates after a trip, in form order. The operator
// also carries optional sub-dimensions; the vehicle is stars + comment only (the
// slice-2 DIRECTION map rejects sub-dimensions on a renter→VEHICLE review).
export const RENTER_REVIEW_SUBJECTS = ['OPERATOR', 'VEHICLE'] as const
export type RenterReviewSubject = (typeof RENTER_REVIEW_SUBJECTS)[number]

// Renter→operator sub-dimensions (slice-2 service DIRECTION map). All optional.
export const RENTER_OPERATOR_DIMENSIONS = [
  'cleanliness',
  'accuracy',
  'communication',
  'value',
] as const
export type RenterOperatorDimension = (typeof RENTER_OPERATOR_DIMENSIONS)[number]

// #1084: operator→renter sub-dimensions (slice-2 service DIRECTION map). All optional.
// The operator only ever rates the RENTER subject, so there is no subject selector — just
// these three dims plus the required overall.
export const OPERATOR_RENTER_DIMENSIONS = ['communication', 'cleanliness', 'ruleAdherence'] as const
export type OperatorRenterDimension = (typeof OPERATOR_RENTER_DIMENSIONS)[number]

// JSON-serialized review (#1082) as the renter read model sees it. A lean subset of
// the API entity — enough to decide which subjects remain unreviewed and to show a
// submitted rating; zod strips the rest of the row at the seam.
export interface ReviewDto {
  id: string
  bookingId: string
  authorRole: ReviewAuthorRole
  subject: ReviewSubject
  overall: number
  comment: string | null
  publishedAt: string | null
}

// #711: pin the runtime parse to the DTO via `satisfies z.ZodType<…>` so a dropped
// field fails as a ParseError at the seam, not as `undefined` in render.
const reviewDtoSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  authorRole: z.enum(REVIEW_AUTHOR_ROLES),
  subject: z.enum(REVIEW_SUBJECTS),
  overall: z.number(),
  comment: z.string().nullable(),
  publishedAt: z.string().nullable(),
}) satisfies z.ZodType<ReviewDto>

// What a participant submits for ONE subject. The server derives operatorId, authorRole,
// and the reveal window — none are client fields. `subRatings` is sent only when
// non-empty (a vehicle review carries none); `comment` only when non-blank. `subject`
// spans the full set so the operator side (#1084) can submit RENTER through the same
// seam; the server's DIRECTION map rejects any caller/subject mismatch.
export interface SubmitReviewInput {
  bookingId: string
  subject: ReviewSubject
  overall: number
  subRatings?: Record<string, number>
  comment?: string | null
}

// POST /reviews (#1082) — cookie-authenticated + CSRF-gated, so the caller echoes the
// session CSRF token. `unwrap` throws an ApiError carrying the status, so the form can
// treat 409 ALREADY_REVIEWED as benign.
export async function submitReview(
  input: SubmitReviewInput,
  csrfToken: string,
): Promise<ReviewDto> {
  const subRatings =
    input.subRatings && Object.keys(input.subRatings).length > 0 ? input.subRatings : undefined
  const comment = input.comment?.trim() ? input.comment.trim() : undefined
  const res = await fetch(`${getApiBaseUrl()}/reviews`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({
      bookingId: input.bookingId,
      subject: input.subject,
      overall: input.overall,
      ...(subRatings ? { subRatings } : {}),
      ...(comment ? { comment } : {}),
    }),
  })
  const { review } = await unwrap(res, z.object({ review: reviewDtoSchema }))
  return review
}

// GET /bookings/:bookingId/reviews (#1082) — participant-scoped, double-blind. Returns
// the caller's own rows plus any revealed counterparty rows.
export async function fetchReviewsForBooking(bookingId: string): Promise<ReviewDto[]> {
  const res = await fetch(`${getApiBaseUrl()}/bookings/${encodeURIComponent(bookingId)}/reviews`, {
    credentials: 'include',
  })
  const { reviews } = await unwrap(res, z.object({ reviews: z.array(reviewDtoSchema) }))
  return reviews
}

export function reviewsForBookingQueryOptions(bookingId: string) {
  return queryOptions({
    queryKey: ['reviews', bookingId],
    queryFn: () => fetchReviewsForBooking(bookingId),
  })
}

// #1083: the prefix every reviews query is keyed under. A submit invalidates THIS key;
// React Query's prefix match refreshes every booking's reviews in one call.
export const REVIEWS_KEY = ['reviews'] as const

// The subjects the renter has already reviewed for a booking — drives prompt
// visibility. A renter only ever authors RENTER-role rows, so the published
// counterparty (OPERATOR) rows the read may also return are excluded here.
export function renterReviewedSubjects(reviews: readonly ReviewDto[]): ReviewSubject[] {
  return reviews.filter((r) => r.authorRole === 'RENTER').map((r) => r.subject)
}

// The renter-review subjects still missing for a booking (form order preserved).
export function pendingReviewSubjects(reviewed: readonly ReviewSubject[]): RenterReviewSubject[] {
  return RENTER_REVIEW_SUBJECTS.filter((s) => !reviewed.includes(s))
}

// #1084/#1158: whether the operator side has already reviewed this booking. The
// operator→renter review is the TENANT's, not a staff member's, so ANY OPERATOR-role
// row settles it — the API surfaces a colleague's still-hidden row to operator staff,
// so the rate-renter prompt hides once any staff member has reviewed.
export function operatorReviewedRenter(reviews: readonly ReviewDto[]): boolean {
  return reviews.some((r) => r.authorRole === 'OPERATOR')
}
