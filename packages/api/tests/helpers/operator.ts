import { InMemoryOperatorRepository } from '../../src/repositories/in-memory'
import type { Operator } from '../../src/stores'
import { type ResolveWriteOperatorId, resolveOperatorIdForWrite } from '../../src/tenancy'

/** The seeded sole operator most route tests run against (single-operator MVP). */
export const TEST_OPERATOR_ID = 'op_test'

/**
 * The production write-operator resolver, used as-is in route tests (#407):
 * operator-role callers resolve to their own `ctx.operatorId`; a non-operator
 * (STAFF/ADMIN) create must send an explicit `operatorId` in the body, else
 * `OperatorRequiredError` -> 422. Sole-operator inference is retired, so a
 * non-operator create without `operatorId` is always rejected.
 */
export function testResolveWriteOperatorId(): ResolveWriteOperatorId {
  return (ctx, input) => resolveOperatorIdForWrite(ctx, input)
}

/**
 * An in-memory operator repo seeded with exactly one operator, for
 * `createApp`-based tests. Non-operator creates now send an explicit
 * `operatorId` (sole-operator inference was retired in #407); this just
 * provides the operator row their writes reference.
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
