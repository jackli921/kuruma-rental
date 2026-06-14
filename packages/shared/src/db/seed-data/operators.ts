import {
  BEST_CAR_RENTAL_NAME,
  BEST_CAR_RENTAL_OPERATOR_ID,
  BEST_CAR_RENTAL_OWNER_EMAIL,
  BEST_CAR_RENTAL_OWNER_NAME,
  BEST_CAR_RENTAL_SLUG,
  SECOND_OPERATOR_ID,
  SECOND_OPERATOR_NAME,
  SECOND_OPERATOR_OWNER_EMAIL,
  SECOND_OPERATOR_OWNER_NAME,
  SECOND_OPERATOR_SLUG,
} from '../constants'
import type { operators } from '../schema'

/**
 * Slice 8 demo seed fixtures (#390, §3.1). Pure typed data — no DB writes here;
 * the seed builders in `seed.ts` consume these. Three operators give the demo a
 * credible multi-tenant marketplace (proposal §9 item 9). Best Car Rental reuses
 * the existing `constants.ts` identity so reseeds stay stable as composite-FK
 * targets; the two new operators get `@example.test` owner logins.
 */
export interface DemoOwner {
  readonly email: string
  readonly name: string
}

/** The `operators`-row half of a demo operator, plus its login owner. */
export type DemoOperator = Pick<
  typeof operators.$inferInsert,
  'id' | 'slug' | 'name' | 'preAuthHandoffUrl'
> & {
  readonly id: string
  readonly slug: string
  readonly preAuthHandoffUrl: string | null
  readonly owner: DemoOwner
}

export const DEMO_OPERATORS: readonly DemoOperator[] = [
  {
    id: BEST_CAR_RENTAL_OPERATOR_ID,
    slug: BEST_CAR_RENTAL_SLUG,
    name: BEST_CAR_RENTAL_NAME,
    preAuthHandoffUrl: 'https://preauth.best-car-rental.example/stripe',
    owner: { email: BEST_CAR_RENTAL_OWNER_EMAIL, name: BEST_CAR_RENTAL_OWNER_NAME },
  },
  {
    id: SECOND_OPERATOR_ID,
    slug: SECOND_OPERATOR_SLUG,
    name: SECOND_OPERATOR_NAME,
    preAuthHandoffUrl: 'https://preauth.kansai-drive.example/stripe',
    owner: { email: SECOND_OPERATOR_OWNER_EMAIL, name: SECOND_OPERATOR_OWNER_NAME },
  },
  {
    id: 'op_sakura_mobility',
    slug: 'sakura-mobility',
    name: 'Sakura Mobility',
    preAuthHandoffUrl: 'https://preauth.sakura-mobility.example/stripe',
    owner: { email: 'owner@sakura-mobility.example.test', name: 'Sakura Mobility Owner' },
  },
] as const
