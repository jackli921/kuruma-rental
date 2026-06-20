import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DrizzleUserRepository } from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle/shared'
import { db } from './setup'

// #939 regression. The session-revocation check (index.ts) compares the LIVE
// users-projection operatorId/role against the JWT's claims. DrizzleUserRepository
// therefore MUST return operatorId on read — when it was omitted from the column
// projection, projection.operatorId came back undefined and isStaleOperatorSession
// flagged EVERY operator token as stale (undefined != claim), 401'ing all operator
// traffic. Only the real-DB layer exercises Drizzle, so unit/integration-on-InMemory
// stayed green (InMemory returns the whole row); this asserts the parity Drizzle broke.
const userRepo = new DrizzleUserRepository(db as unknown as Db)

const operatorUserId = crypto.randomUUID()

beforeAll(async () => {
  // operatorId reuses the global-setup Best Car Rental operator (FK restrict).
  await db.insert(users).values({
    id: operatorUserId,
    email: `op-projection-${Date.now()}@kuruma-test.com`,
    role: 'OPERATOR_OWNER',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    language: 'en',
  })
})

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, [operatorUserId]))
})

describe('DrizzleUserRepository.findByIds (postgres) — operator tenant projection', () => {
  it('returns operatorId + role so the #939 revocation check matches the JWT claim', async () => {
    const [row] = await userRepo.findByIds([operatorUserId])

    expect(row?.role).toBe('OPERATOR_OWNER')
    expect(row?.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
  })
})
