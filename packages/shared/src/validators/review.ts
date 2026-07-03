import { z } from 'zod'
import { REVIEW_SUBJECTS } from '../enums'

// REVIEW_DIMENSIONS lives in enums.ts beside its sibling review enums (the closed-set
// SSoT); re-exported here so existing `@kuruma/shared/validators/review` importers are
// unaffected.
export { REVIEW_DIMENSIONS, type ReviewDimension } from '../enums'

// 1-5 whole stars — mirrors the DB reviews_overall_range_chk.
const starRating = z.number().int().min(1).max(5)

// Any SUBSET of the named dimensions, each 1-5. `.strict()` rejects a foreign key
// (a typo'd or injected dimension) outright rather than silently dropping it, so
// nothing outside REVIEW_DIMENSIONS reaches the column. Mirrors REVIEW_DIMENSIONS above.
const subRatingsSchema = z
  .object({
    cleanliness: starRating.optional(),
    accuracy: starRating.optional(),
    communication: starRating.optional(),
    value: starRating.optional(),
    ruleAdherence: starRating.optional(),
  })
  .strict()
export type ReviewSubRatings = z.infer<typeof subRatingsSchema>

const commentField = z.string().trim().max(2000).optional()

/** Submit a new review. `authorRole` + author identity are derived server-side from the
 *  session (never the client); `subject` names the target side. */
export const submitReviewSchema = z
  .object({
    bookingId: z.string().uuid('Booking ID must be a valid UUID'),
    subject: z.enum(REVIEW_SUBJECTS),
    overall: starRating,
    subRatings: subRatingsSchema.default({}),
    comment: commentField,
  })
  // `.strict()` rejects unknown keys outright (matching subRatingsSchema) so a client
  // cannot smuggle authorRole/authorUserId/publishedAt — they 400 instead of silently
  // dropping. Those identity/reveal fields are derived server-side, never from the body.
  .strict()
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>

/** Edit a still-hidden review. Identified by route param; only ratable content is editable. */
export const editReviewSchema = z
  .object({
    overall: starRating,
    subRatings: subRatingsSchema.default({}),
    comment: commentField,
  })
  .strict()
export type EditReviewInput = z.infer<typeof editReviewSchema>

/** Report a review for moderation (slice 6). */
export const reportReviewSchema = z
  .object({
    reason: z.string().trim().min(1, 'A reason is required').max(500),
  })
  .strict()
export type ReportReviewInput = z.infer<typeof reportReviewSchema>
