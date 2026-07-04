import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  REVIEW_AUTHOR_ROLES,
  REVIEW_SUBJECTS,
  type ReviewAuthorRole,
  type ReviewSubject,
} from '@kuruma/shared/enums'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
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

// --- #1085 slice 5: public aggregate read surface --------------------------

/** Public aggregate subject kinds — mirror the api `routes/review-aggregates.ts`
 *  path segments so a typo here fails at the wire boundary, not in the URL. */
export const AGGREGATE_SUBJECT_KINDS = ['operators', 'vehicles', 'classes'] as const
export type AggregateSubjectKind = (typeof AGGREGATE_SUBJECT_KINDS)[number]

/** Display-quality avg + count. `null` for an id that the caller named but has
 *  no published+visible reviews yet — distinguishes "no reviews" from a 0 avg. */
export interface AggregateEntry {
  avg: number
  count: number
}
export type AggregateMap = Record<string, AggregateEntry | null>

const aggregateEntrySchema = z.object({
  avg: z.number(),
  count: z.number(),
}) satisfies z.ZodType<AggregateEntry>

const aggregateResponseSchema = z.object({
  aggregates: z.record(z.string(), aggregateEntrySchema.nullable()),
})

/** Sort + dedupe so two callers asking for `[a,b]` and `[b,a]` share one cache
 *  entry; the API dedupes server-side anyway, so this is purely a render-tier
 *  cache-hit win. Returns a stable readonly tuple safe to use as a query key. */
function normalizeAggregateIds(ids: readonly string[]): readonly string[] {
  return Array.from(new Set(ids)).sort()
}

// --- #1067 review-display slice: public per-operator review list ---------------

// Schema is the single source of truth; the type is derived so the two can't drift.
const publicReviewDtoSchema = z.object({
  id: z.string(),
  overall: z.number(),
  subRatings: z.record(z.string(), z.number()),
  comment: z.string().nullable(),
  publishedAt: z.string(),
  // #1450: the reviewer's first name only (server-derived; the full name never crosses the
  // wire), or null for the anonymous fallback. Required so a dropped field fails at the seam.
  reviewerFirstName: z.string().nullable(),
})

/** Public review wire shape from GET /reviews/for/operators/:id.
 *  Curated: no bookingId or authorUserId exposed to the render tier.
 *  subRatings is the dimension→stars map ({} when no sub-dimensions rated). */
export type PublicReviewDto = z.infer<typeof publicReviewDtoSchema>

// One page of reviews + the opaque keyset cursor for the next (#1449). `nextCursor` is
// required (null on the last page) so a dropped field fails at the seam, not as a silent
// "no more pages" that would truncate the list. Subject-agnostic: the operator (#1449) and
// vehicle (#1448) lists share this exact wire shape — only the URL segment + cache key differ.
const reviewPageSchema = z.object({
  reviews: z.array(publicReviewDtoSchema),
  nextCursor: z.string().nullable(),
})

/** A page of a public review list (operator or vehicle subject). */
export type ReviewPage = z.infer<typeof reviewPageSchema>

/** GET /reviews/for/operators/:id[?after=cursor] — public, anonymous (no credentials).
 *  `after` is the opaque token from a previous page's nextCursor; omit for the first page. */
export async function fetchOperatorReviews(
  operatorId: string,
  after?: string | null,
): Promise<ReviewPage> {
  return fetchSubjectReviews('operators', operatorId, after)
}

/** GET /reviews/for/vehicles/:id[?after=cursor] — public, anonymous (#1448). Mirrors the
 *  operator reader against the VEHICLE subject path the API already serves. */
export async function fetchVehicleReviews(
  vehicleId: string,
  after?: string | null,
): Promise<ReviewPage> {
  return fetchSubjectReviews('vehicles', vehicleId, after)
}

/** Shared fetch for the public per-subject review list. The subject is a fixed URL
 *  segment (`operators` | `vehicles`), never user input, so it needs no encoding. */
async function fetchSubjectReviews(
  subject: 'operators' | 'vehicles',
  id: string,
  after?: string | null,
): Promise<ReviewPage> {
  const base = `${getApiBaseUrl()}/reviews/for/${subject}/${encodeURIComponent(id)}`
  const url = after ? `${base}?after=${encodeURIComponent(after)}` : base
  const res = await fetch(url)
  return unwrap(res, reviewPageSchema)
}

/** Infinite ("load more") query over the operator review list (#1449). The page param IS
 *  the cursor: null for the first page, then each page's nextCursor until it comes back
 *  null (hasNextPage=false). Same cache key prefix as the aggregate/badge reads. */
export function operatorReviewsInfiniteQueryOptions(operatorId: string) {
  return infiniteQueryOptions({
    queryKey: ['reviews', 'list', 'operators', operatorId] as const,
    queryFn: ({ pageParam }) => fetchOperatorReviews(operatorId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

/** Infinite ("load more") query over a vehicle's review list (#1448). Keyed under the
 *  `vehicles` subject so it can never collide with the same-shaped operator list. */
export function vehicleReviewsInfiniteQueryOptions(vehicleId: string) {
  return infiniteQueryOptions({
    queryKey: ['reviews', 'list', 'vehicles', vehicleId] as const,
    queryFn: ({ pageParam }) => fetchVehicleReviews(vehicleId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

/** GET /reviews/aggregates/:kind?ids=… (public; no cookie needed). Empty `ids`
 *  bypasses the network and returns `{}` so a render with no subjects to fetch
 *  still resolves immediately — matches `queryOptions.enabled: false` below. */
export async function fetchAggregates(
  kind: AggregateSubjectKind,
  ids: readonly string[],
): Promise<AggregateMap> {
  const normalized = normalizeAggregateIds(ids)
  if (normalized.length === 0) return {}
  const url = `${getApiBaseUrl()}/reviews/aggregates/${kind}?ids=${encodeURIComponent(normalized.join(','))}`
  const res = await fetch(url, { credentials: 'include' })
  const { aggregates } = await unwrap(res, aggregateResponseSchema)
  return aggregates
}

/** TanStack Query options keyed on the (sorted+deduped) id set. Disabled when
 *  no ids — the caller can pass a variable list without an explicit `enabled`
 *  guard at the call site. */
export function reviewAggregatesQueryOptions(kind: AggregateSubjectKind, ids: readonly string[]) {
  const normalized = normalizeAggregateIds(ids)
  return queryOptions({
    queryKey: ['reviews', 'aggregates', kind, normalized] as const,
    queryFn: () => fetchAggregates(kind, normalized),
    enabled: normalized.length > 0,
  })
}
