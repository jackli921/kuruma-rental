import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { REVIEW_AUTHOR_ROLES, REVIEW_MODERATION_STATUSES, REVIEW_SUBJECTS } from '../enums'
import { operators, users } from './auth'
import { bookings } from './booking'
import { vehicleClasses, vehicles } from './fleet'

export const reviewAuthorRoleEnum = pgEnum('review_author_role', REVIEW_AUTHOR_ROLES)
export const reviewSubjectEnum = pgEnum('review_subject', REVIEW_SUBJECTS)
export const reviewModerationStatusEnum = pgEnum(
  'review_moderation_status',
  REVIEW_MODERATION_STATUSES,
)

/**
 * Mutual, double-blind reviews (#1067). After a booking COMPLETEs, both sides may
 * review: renter -> operator, renter -> vehicle, operator -> renter. Each review
 * stays hidden (`publishedAt IS NULL`) until BOTH sides submit OR the 14-day window
 * (`revealDeadlineAt`) elapses, then auto-publishes — preventing retaliation bias.
 * The row-shape invariants below live in Postgres, not service promises (slice 1).
 */
export const reviews = pgTable(
  'reviews',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookingId: text('bookingId')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    // Denormalized tenant scope (the booking's operator) so operator-scoped reads and
    // the (operatorId, publishedAt) aggregate index never need a bookings join.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    authorUserId: text('authorUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    authorRole: reviewAuthorRoleEnum('authorRole').notNull(),
    subject: reviewSubjectEnum('subject').notNull(),
    // Denormalized for subject=VEHICLE aggregates (slice 5); NULL for non-vehicle reviews.
    subjectVehicleId: text('subjectVehicleId').references(() => vehicles.id, {
      onDelete: 'restrict',
    }),
    subjectClassId: text('subjectClassId').references(() => vehicleClasses.id, {
      onDelete: 'restrict',
    }),
    overall: integer('overall').notNull(),
    // Optional named sub-dimensions (cleanliness/communication/...); keys are validated
    // in @kuruma/shared/validators/review by (authorRole, subject). Default {} = none given.
    subRatings: jsonb('subRatings').$type<Record<string, number>>().notNull().default({}),
    comment: text('comment'),
    moderationStatus: reviewModerationStatusEnum('moderationStatus').notNull().default('VISIBLE'),
    // The 14-day double-blind deadline; reveal fires at the earlier of both-submitted or this.
    revealDeadlineAt: timestamp('revealDeadlineAt', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submittedAt', { withTimezone: true }).notNull().defaultNow(),
    // The reveal flag: NULL until published (both submitted OR window elapsed).
    publishedAt: timestamp('publishedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one review per author per booking per subject — edit-until-published, never re-insert.
    unique('reviews_author_subject_per_booking_unique').on(t.bookingId, t.authorUserId, t.subject),
    check('reviews_overall_range_chk', sql`${t.overall} BETWEEN 1 AND 5`),
    // Operators review ONLY renters; renters review the operator or a vehicle (never a renter).
    check(
      'reviews_subject_pairing_chk',
      sql`(${t.authorRole} = 'OPERATOR') = (${t.subject} = 'RENTER')`,
    ),
    // A vehicle review carries its vehicle id; a non-vehicle review never does.
    check(
      'reviews_vehicle_subject_chk',
      sql`(${t.subject} = 'VEHICLE') = (${t.subjectVehicleId} IS NOT NULL)`,
    ),
    // FK-covering + read indexes (lint:fk-indexes). bookingId is the LEADING column of the
    // unique above, so it needs no separate index; authorUserId (2nd there) does.
    index('idx_reviews_authorUserId').on(t.authorUserId),
    // operatorId FK cover + the slice-5 published-aggregate scan.
    index('idx_reviews_operator_published').on(t.operatorId, t.publishedAt),
    index('idx_reviews_subject_vehicle').on(t.subjectVehicleId),
    index('idx_reviews_subject_class').on(t.subjectClassId),
    // The sweep query (slice 2): reviews past their window still awaiting reveal.
    index('idx_reviews_reveal_due')
      .on(t.revealDeadlineAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
)
