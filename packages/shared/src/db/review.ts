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
  uniqueIndex,
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
    // Denormalized class of the reviewed vehicle for slice-5 class-level aggregates.
    // Only ever set on a VEHICLE review, and only when the vehicle HAS a class —
    // vehicles.classId is nullable, so a VEHICLE review of an unclassed car carries NULL
    // here. NULL on every non-vehicle review (sealed by reviews_class_subject_chk).
    subjectClassId: text('subjectClassId').references(() => vehicleClasses.id, {
      onDelete: 'restrict',
    }),
    overall: integer('overall').notNull(),
    // Optional named sub-dimensions (cleanliness/communication/...). Both the key set and
    // each 1-5 value are enforced ONLY at the Zod boundary (validators/review) — jsonb
    // carries no DB CHECK here — so every writer MUST go through the validator. The precise
    // per-direction key subset is checked by (authorRole, subject). Default {} = none given.
    subRatings: jsonb('subRatings').$type<Record<string, number>>().notNull().default({}),
    comment: text('comment'),
    moderationStatus: reviewModerationStatusEnum('moderationStatus').notNull().default('VISIBLE'),
    // Moderation audit trail (#1454): which platform admin last flipped moderationStatus,
    // and when. Both NULL on a never-moderated review; stamped together on every hide so a
    // multi-admin platform can attribute the action. `moderatedAt` is distinct from the
    // mutable `updatedAt` (which any write bumps) — it marks the moderation instant only.
    moderatedBy: text('moderatedBy').references(() => users.id, { onDelete: 'restrict' }),
    moderatedAt: timestamp('moderatedAt', { withTimezone: true }),
    // The 14-day double-blind deadline; reveal fires at the earlier of both-submitted or this.
    revealDeadlineAt: timestamp('revealDeadlineAt', { withTimezone: true }).notNull(),
    submittedAt: timestamp('submittedAt', { withTimezone: true }).notNull().defaultNow(),
    // The reveal flag: NULL until published (both submitted OR window elapsed).
    publishedAt: timestamp('publishedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One review per booking per subject — the single seal for all three sides (#1201).
    // subject is CHECK-sealed to the author side (reviews_subject_pairing_chk), so this is
    // provably one operator->renter, one renter->operator, one renter->vehicle per booking
    // WITHOUT depending on the denormalized operatorId. There is exactly one renter per
    // booking, and the first staff member to submit speaks for the operator (#1158).
    uniqueIndex('reviews_subject_per_booking_unique').on(t.bookingId, t.subject),
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
    // A class tag only ever rides a VEHICLE review. One-way, NOT a biconditional:
    // vehicles.classId is nullable, so a VEHICLE review of an unclassed car legitimately
    // carries no class — this seals stray class ids off non-vehicle reviews without
    // forcing every vehicle review to have one.
    check(
      'reviews_class_subject_chk',
      sql`${t.subjectClassId} IS NULL OR ${t.subject} = 'VEHICLE'`,
    ),
    // FK-covering + read indexes (lint:fk-indexes wants every FK column to have its own index).
    // bookingId's FK cover is the reseal uniqueIndex above: bookingId is its leading column, so it
    // serves findByBookingId AND satisfies the lint (which reads CREATE [UNIQUE] INDEX). A separate
    // idx_reviews_bookingId would be a redundant second btree on the same prefix — dropped in #1225.
    index('idx_reviews_authorUserId').on(t.authorUserId),
    // moderatedBy FK cover (#1454). Sparse (NULL on unmoderated rows); satisfies lint:fk-indexes.
    index('idx_reviews_moderatedBy').on(t.moderatedBy),
    // operatorId FK cover + the slice-5 published-aggregate scan.
    index('idx_reviews_operator_published').on(t.operatorId, t.publishedAt),
    index('idx_reviews_subject_vehicle').on(t.subjectVehicleId),
    index('idx_reviews_subject_class').on(t.subjectClassId),
    // Slice-5 vehicle/class aggregate cover (#1220). The aggregate is
    //   SELECT <key>, SUM(overall), COUNT(*) FROM reviews
    //   WHERE <key> IN (...) AND publishedAt IS NOT NULL AND moderationStatus = 'VISIBLE' GROUP BY <key>
    // The PARTIAL predicate prunes the btree to the published+visible slice, and `overall`
    // rides as the trailing key column so SUM(overall)+COUNT(*) are answered by an Index
    // Only Scan (Heap Fetches: 0) — measured ~80x fewer buffers at 50k rows/vehicle vs the
    // single-column indexes, which force a heap fetch for `overall`. `overall` is a NOT NULL
    // int4; making it a trailing key (vs an INCLUDE, which drizzle 0.45 can't express) keeps
    // this fully in the schema DSL — no hand-SQL divergence — at a negligible size cost.
    //
    // The single-column idx_reviews_subject_{vehicle,class} above stay: they are the
    // non-partial FK cover lint:fk-indexes requires (a partial index can't cover an FK).
    index('idx_reviews_subject_vehicle_published')
      .on(t.subjectVehicleId, t.publishedAt, t.overall)
      .where(sql`${t.moderationStatus} = 'VISIBLE' AND ${t.publishedAt} IS NOT NULL`),
    index('idx_reviews_subject_class_published')
      .on(t.subjectClassId, t.publishedAt, t.overall)
      .where(sql`${t.moderationStatus} = 'VISIBLE' AND ${t.publishedAt} IS NOT NULL`),
    // The sweep query (slice 2): reviews past their window still awaiting reveal.
    index('idx_reviews_reveal_due')
      .on(t.revealDeadlineAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
)
