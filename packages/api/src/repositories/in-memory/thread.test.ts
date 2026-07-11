import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryThreadRepository } from './thread'

// Messaging GA hardening (Refs #1476): findPage pushes limit/offset + the total
// count down instead of the service loading every in-scope thread and slicing in
// memory (a PLATFORM_ADMIN 'all' scope would otherwise fan out platform-wide on
// every GET /threads). These pin the paginated contract + deterministic ordering
// that the Drizzle side must mirror (asserted against real-pg in integration).

const RENTER = 'renter-findpage'
const ctx: CallerContext = { userId: RENTER, role: 'RENTER' }

/** Seed n threads the caller participates in, oldest first, with distinct
 *  createdAt so newest-first ordering is unambiguous. Returns ids in creation
 *  order (ids[0] oldest ... ids[n-1] newest). */
async function seedThreads(repo: InMemoryThreadRepository, n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const thread = await repo.create(ctx, null, [RENTER, `peer-${i}`], null, null)
    ids.push(thread.id)
    await new Promise((r) => setTimeout(r, 2))
  }
  return ids
}

describe('InMemoryThreadRepository.findPage', () => {
  it('returns the requested slice and the total in-scope count', async () => {
    const repo = new InMemoryThreadRepository()
    const ids = await seedThreads(repo, 5)

    const page = await repo.findPage(ctx, { limit: 2, offset: 1 })

    expect(page.total).toBe(5)
    expect(page.threads).toHaveLength(2)
    for (const t of page.threads) expect(ids).toContain(t.id)
  })

  it('orders newest-created first and paginates with no overlap or gaps', async () => {
    const repo = new InMemoryThreadRepository()
    const ids = await seedThreads(repo, 5)

    const p1 = await repo.findPage(ctx, { limit: 2, offset: 0 })
    const p2 = await repo.findPage(ctx, { limit: 2, offset: 2 })
    const p3 = await repo.findPage(ctx, { limit: 2, offset: 4 })

    const ordered = [...p1.threads, ...p2.threads, ...p3.threads].map((t) => t.id)
    expect(ordered).toEqual([...ids].reverse())
    expect(p3.threads).toHaveLength(1)
  })

  it('scopes total to the caller and hydrates participants + last message', async () => {
    const repo = new InMemoryThreadRepository()
    // A thread the caller is NOT part of must not count toward total.
    await repo.create({ userId: 'someone-else', role: 'RENTER' }, null, ['someone-else', 'x'])
    const [mine] = await seedThreads(repo, 1)

    const page = await repo.findPage(ctx, { limit: 10, offset: 0 })

    expect(page.total).toBe(1)
    expect(page.threads).toHaveLength(1)
    expect(page.threads[0]!.id).toBe(mine)
    expect(page.threads[0]!.participants.map((p) => p.userId).sort()).toEqual(['peer-0', RENTER])
    expect(page.threads[0]!.lastMessage).toBeNull()
  })
})
