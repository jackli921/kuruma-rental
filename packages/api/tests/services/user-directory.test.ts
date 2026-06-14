import { beforeEach, describe, expect, it } from 'vitest'
import { type AuthUser, toCallerContext } from '../../src/middleware/auth'
import { InMemoryThreadRepository, InMemoryUserRepository } from '../../src/repositories/in-memory'
import { UserDirectoryService } from '../../src/services/user-directory'

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3' // shares no thread with U1

let userRepo: InMemoryUserRepository
let threadRepo: InMemoryThreadRepository
let service: UserDirectoryService

function ctxFor(userId: string, role: AuthUser['role'], operatorId?: string) {
  return toCallerContext(operatorId ? { id: userId, role, operatorId } : { id: userId, role })
}

beforeEach(async () => {
  const store = new Map([
    [U1, { id: U1, name: 'Alice', email: 'a@x', language: 'en' }],
    [U2, { id: U2, name: 'Bob', email: 'b@x', language: 'en' }],
    [U3, { id: U3, name: 'Carol', email: 'c@x', language: 'en' }],
  ])
  userRepo = new InMemoryUserRepository(store)
  threadRepo = new InMemoryThreadRepository()
  // U1 and U2 share a thread; U3 is unrelated to U1.
  await threadRepo.create({ userId: U1, role: 'RENTER' }, null, [U1, U2], null)
  service = new UserDirectoryService(userRepo, threadRepo)
})

describe('UserDirectoryService.resolveVisibleUsers', () => {
  it('omits ids a renter shares no thread with (no name-harvest oracle)', async () => {
    const result = await service.resolveVisibleUsers(ctxFor(U1, 'RENTER'), [U2, U3])

    expect(result).toEqual([{ id: U2, name: 'Bob' }])
  })

  it('lets a renter resolve themselves even with no threads', async () => {
    const result = await service.resolveVisibleUsers(ctxFor(U2, 'RENTER'), [U2, U3])

    expect(result).toEqual([{ id: U2, name: 'Bob' }])
  })

  it('lets a privileged role resolve any user', async () => {
    const result = await service.resolveVisibleUsers(ctxFor(U1, 'STAFF'), [U2, U3])

    expect(result).toContainEqual({ id: U2, name: 'Bob' })
    expect(result).toContainEqual({ id: U3, name: 'Carol' })
    expect(result).toHaveLength(2)
  })

  it('restricts an operator to itself, never another tenant via a shared thread (#396)', async () => {
    // U1 (operator) shares the seeded thread with U2, but operators are self-only.
    const result = await service.resolveVisibleUsers(ctxFor(U1, 'OPERATOR_OWNER', 'op-1'), [U1, U2])

    expect(result).toEqual([{ id: U1, name: 'Alice' }])
  })
})
