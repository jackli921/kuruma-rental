/**
 * Transitional default operator (marketplace slice 1, #386).
 *
 * The seed inserts this operator so legacy STAFF / ADMIN / PLATFORM_ADMIN write
 * paths have a tenant to attach to until operator-portal write flows land in a
 * later slice. `operators.id` is a `text` column, so a fixed readable id is
 * safe and greppable. Remove the write-time fallback (see
 * `resolveOperatorIdForWrite`) once admin create endpoints take an explicit
 * operatorId.
 */
export const BEST_CAR_RENTAL_OPERATOR_ID = 'op_best_car_rental'
export const BEST_CAR_RENTAL_SLUG = 'best-car-rental'
export const BEST_CAR_RENTAL_NAME = 'Best Car Rental'

/**
 * Seed identity for the Best Car Rental owner (the first OPERATOR_OWNER login
 * used in demos). A `.local` placeholder email keeps the real owner's contact
 * details out of the repo; update it in the DB once the real account exists.
 */
export const BEST_CAR_RENTAL_OWNER_EMAIL = 'owner@best-car-rental.local'
export const BEST_CAR_RENTAL_OWNER_NAME = 'Best Car Rental Owner'

/**
 * Second demo tenant (Kansai Drive). Promoted out of the `DEMO_OPERATORS` inline
 * literal so the multi-actor real-DB test harness (#654) and the seed share ONE
 * source for the second operator: integration `global-setup` seeds it by id and
 * cross-tenant tests scope to it via `ctxFor`, while the e2e harness mints a
 * token off the owner email. Drift here would silently scope a fixture/token to
 * a non-existent operator (a 404 with no error) — see `harness-actors.test.ts`.
 */
export const SECOND_OPERATOR_ID = 'op_kansai_drive'
export const SECOND_OPERATOR_SLUG = 'kansai-drive'
export const SECOND_OPERATOR_NAME = 'Kansai Drive'
export const SECOND_OPERATOR_OWNER_EMAIL = 'owner@kansai-drive.example.test'
export const SECOND_OPERATOR_OWNER_NAME = 'Kansai Drive Owner'

/**
 * Second demo renter (Tanaka Yui, ja). Promoted out of the `DEMO_RENTERS` inline
 * literal for the same single-source reason (#654). `@example.test` keeps the
 * `seed-bookings` cleanup grep matching — never change the domain.
 */
export const SECOND_RENTER_ID = 'usr_renter_yui'
export const SECOND_RENTER_EMAIL = 'yui@example.test'
export const SECOND_RENTER_NAME = 'Tanaka Yui'
export const SECOND_RENTER_LANGUAGE = 'ja'
