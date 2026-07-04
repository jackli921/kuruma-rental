import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './auth'
import { reviews } from './review'

/**
 * A user's report of a published review for moderator attention (#1086, #1067 slice 6).
 *
 * Report-only, by owner decision: a report NEVER auto-hides the review — it only queues
 * it for a platform admin, who decides whether to flip `reviews.moderationStatus` to
 * HIDDEN. This keeps the double-blind trust model retaliation-proof: a bad-faith report
 * cannot suppress a legitimate review, only surface it for human review.
 *
 * One report per (review, reporter) so a single user can't inflate the moderation queue.
 * The row is retained for audit even after the review is hidden or the report actioned.
 */
export const reviewReports = pgTable(
  'review_reports',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // A report is a dependent child of its review: cascade so it dies with the review.
    // (Reviews are soft-hidden, never hard-deleted, so this is latent — but a report has
    // no meaning without its referent, unlike the restrict'd user below.)
    reviewId: text('reviewId')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    // restrict: never lose the "who reported" audit trail by deleting the user.
    reporterUserId: text('reporterUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Free-text reason; length/emptiness enforced at the Zod boundary (reportReviewSchema).
    reason: text('reason').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One report per reporter per review. reviewId is the leading column, so this unique
    // index also serves "reports for this review" AND satisfies lint:fk-indexes' FK cover
    // for reviewId (a separate idx_review_reports_reviewId would be a redundant prefix btree).
    uniqueIndex('review_reports_one_per_reporter').on(t.reviewId, t.reporterUserId),
    // FK cover for reporterUserId (not the leading column of the unique index above).
    index('idx_review_reports_reporterUserId').on(t.reporterUserId),
  ],
)
