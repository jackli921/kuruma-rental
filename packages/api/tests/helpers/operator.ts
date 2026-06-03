import { InMemoryOperatorRepository } from '../../src/repositories/in-memory'
import type { Operator } from '../../src/stores'
import { type ResolveWriteOperatorId, resolveOperatorIdForWrite } from '../../src/tenancy'

/** The seeded sole operator most route tests run against (single-operator MVP). */
export const TEST_OPERATOR_ID = 'op_test'

/**
 * A write-operator resolver backed by a single in-memory operator, so a
 * non-operator (STAFF/ADMIN) create infers that sole operator — mirroring the
 * single-operator MVP. Operator-role callers resolve to their own
 * `ctx.operatorId`. Pass `null` to model the ambiguous case (zero or 2+
 * operators), where a non-operator create with no explicit operatorId is
 * rejected with `OperatorRequiredError` -> 422 (#401).
 */
export function testResolveWriteOperatorId(
  soleOperatorId: string | null = TEST_OPERATOR_ID,
): ResolveWriteOperatorId {
  return (ctx, input) =>
    resolveOperatorIdForWrite(ctx, input, { findSoleId: async () => soleOperatorId })
}

/**
 * An in-memory operator repo seeded with exactly one operator, for
 * `createApp`-based tests whose non-operator creates rely on sole-operator
 * inference (#401).
 */
export function seededOperatorRepo(id: string = TEST_OPERATOR_ID): InMemoryOperatorRepository {
  const now = new Date()
  const operator: Operator = {
    id,
    name: 'Test Operator',
    slug: 'test-operator',
    preAuthHandoffUrl: null,
    createdAt: now,
    updatedAt: now,
  }
  return new InMemoryOperatorRepository(new Map([[id, operator]]))
}
