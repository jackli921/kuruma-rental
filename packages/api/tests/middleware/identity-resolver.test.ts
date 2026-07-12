import { describe, expect, test } from 'vitest'
import type { AuthUser } from '../../src/auth/roles'
import { provideIdentityResolver, resolveCurrentIdentity } from '../../src/middleware/auth'

function ctx(store: Record<string, unknown>) {
  return {
    get: (k: string) => store[k],
    set: (k: string, v: unknown) => {
      store[k] = v
    },
  }
}

const renter: AuthUser = { id: 'user_1', role: 'RENTER' }

describe('resolveCurrentIdentity', () => {
  test('returns undefined when no resolver is registered (fail-open)', async () => {
    expect(await resolveCurrentIdentity(ctx({}), renter)).toBeUndefined()
  })

  test('returns the identity the registered resolver produces', async () => {
    const store: Record<string, unknown> = {}
    const mw = provideIdentityResolver(async (u) =>
      u.id === 'user_1' ? { role: 'OPERATOR_OWNER', operatorId: 'op_9' } : undefined,
    )
    await mw(ctx(store) as never, async () => {})
    expect(await resolveCurrentIdentity(ctx(store), renter)).toEqual({
      role: 'OPERATOR_OWNER',
      operatorId: 'op_9',
    })
  })
})
