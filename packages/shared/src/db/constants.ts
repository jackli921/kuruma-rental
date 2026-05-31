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
