import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '@/routes/$locale/_business/manage/fees'
import { describe, expect, it, vi } from 'vitest'

// The loader prefetches BOTH the fee list and the operator-scoped vehicle
// classes (#528) into the query cache, so the component's useSuspenseQuery
// resolves without a FOUC and the class dropdown is fed scoped classes. It reads
// the operator from loaderDeps so a context switch refetches; the fee key is
// scoped to the picked operator (or 'all'). The class dropdown is NOT scoped by
// the picker yet (slice 3), so it stays parameterless — which is why fees is
// read-only for picker-admins until then.
const loaderDeps = Route.options.loaderDeps as (args: {
  search: { operator?: string | undefined }
}) => { operator: string | undefined }
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
}) => Promise<unknown>

describe('fees route loader', () => {
  it('threads the operator search param through loaderDeps so a context switch refetches', () => {
    expect(loaderDeps({ search: { operator: 'op_9' } })).toEqual({ operator: 'op_9' })
    expect(loaderDeps({ search: {} })).toEqual({ operator: undefined })
  })

  it('prefetches the fee list scoped to the picked operator AND the operator-scoped classes', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })

    expect(ensureQueryData).toHaveBeenCalledTimes(2)
    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['operator-fees', 'op_9'])
    // The operator-scoped class endpoint (#528), NOT the public catalog.
    expect(keys).toContainEqual(['operator-classes', false])
  })

  it('defaults the fee key to the all-scope when no operator is picked', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: undefined } })

    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['operator-fees', 'all'])
  })
})

describe('fees route placement', () => {
  // Guard AC (#530): the page must sit under the `_business` pathless layout so
  // its membership guard runs. The generated tree encodes the parent in the id.
  it('is registered under the _business guard with a clean /manage/fees URL', () => {
    const tree = readFileSync(resolve(process.cwd(), 'src/routeTree.gen.ts'), 'utf8')
    expect(tree).toContain("'/$locale/_business/manage/fees'")
    expect(tree).toContain("'/$locale/manage/fees'")
  })
})
