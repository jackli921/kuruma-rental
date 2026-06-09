import { describe, expect, it, vi } from 'vitest'
import { DrizzleOAuthAccountStore } from '../../src/auth/drizzle-oauth-account-store'
import type { GoogleProfile } from '../../src/auth/google'

// The store is normally an infra adapter proven by integration + the manual
// round-trip, but the concurrent first-login race (#497) needs a deterministic
// unit: we inject a fake @auth/drizzle-adapter so linkAccount can throw on
// demand and a fake db that records the orphan cleanup.

type AdapterMethods = {
  getUserByAccount: ReturnType<typeof vi.fn>
  createUser: ReturnType<typeof vi.fn>
  linkAccount: ReturnType<typeof vi.fn>
}

const PROFILE: GoogleProfile = { sub: 'google-sub-1', email: 'a@example.com', name: 'Aiko' }

function makeStore(opts: {
  adapter: AdapterMethods
  roleRow?: { role: string; operatorId: string | null }
}) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([opts.roleRow ?? { role: 'RENTER', operatorId: null }]),
        }),
      }),
    }),
    delete: vi.fn(() => ({ where: deleteWhere })),
  }
  // biome-ignore lint/suspicious/noExplicitAny: structural fakes for the adapter + db seams.
  const store = new DrizzleOAuthAccountStore(fakeDb as any, opts.adapter as any)
  return { store, fakeDb, deleteWhere }
}

describe('DrizzleOAuthAccountStore.resolveUser', () => {
  it('creates and links a brand-new Google user', async () => {
    const adapter: AdapterMethods = {
      getUserByAccount: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue({ id: 'u-new' }),
      linkAccount: vi.fn().mockResolvedValue(undefined),
    }
    const { store, fakeDb } = makeStore({ adapter })

    const result = await store.resolveUser(PROFILE)

    expect(result).toEqual({ id: 'u-new', role: 'RENTER' })
    expect(adapter.createUser).toHaveBeenCalledTimes(1)
    expect(adapter.linkAccount).toHaveBeenCalledTimes(1)
    expect(fakeDb.delete).not.toHaveBeenCalled()
  })

  it('returns the existing user without creating a duplicate', async () => {
    const adapter: AdapterMethods = {
      getUserByAccount: vi.fn().mockResolvedValue({ id: 'u-existing' }),
      createUser: vi.fn(),
      linkAccount: vi.fn(),
    }
    const { store } = makeStore({
      adapter,
      roleRow: { role: 'OPERATOR_OWNER', operatorId: 'op-1' },
    })

    const result = await store.resolveUser(PROFILE)

    expect(result).toEqual({ id: 'u-existing', role: 'OPERATOR_OWNER', operatorId: 'op-1' })
    expect(adapter.createUser).not.toHaveBeenCalled()
  })

  it('reconciles a concurrent first-login race to the winning user (#497)', async () => {
    const adapter: AdapterMethods = {
      // First read sees no account; after the link conflict, the re-read finds
      // the concurrent winner's account.
      getUserByAccount: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'u-winner' }),
      createUser: vi.fn().mockResolvedValue({ id: 'u-orphan' }),
      linkAccount: vi
        .fn()
        .mockRejectedValue(new Error('duplicate key value violates unique constraint')),
    }
    const { store, fakeDb } = makeStore({ adapter })

    const result = await store.resolveUser(PROFILE)

    expect(result).toEqual({ id: 'u-winner', role: 'RENTER' })
    expect(adapter.getUserByAccount).toHaveBeenCalledTimes(2)
    // The orphan user we created before losing the race is cleaned up.
    expect(fakeDb.delete).toHaveBeenCalledTimes(1)
  })

  it('rethrows a linkAccount failure that is not a lost race', async () => {
    const adapter: AdapterMethods = {
      // The re-read still finds no account, so this was a real failure, not a race.
      getUserByAccount: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue({ id: 'u-orphan' }),
      linkAccount: vi.fn().mockRejectedValue(new Error('connection reset')),
    }
    const { store } = makeStore({ adapter })

    await expect(store.resolveUser(PROFILE)).rejects.toThrow('connection reset')
  })
})
