import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '@/routes/$locale/_business/manage/locations'
import { describe, expect, it, vi } from 'vitest'

// The loader's only job is to prefetch the location list into the query cache so
// the component's useSuspenseQuery resolves without a FOUC. (The api helpers it
// composes are covered in api.test.ts; the write-affordance gating now lives in the
// scope-driven view test.) It reads the operator from loaderDeps so a context
// switch refetches; with no operator picked the scoped key resolves to 'all'.
const loaderDeps = Route.options.loaderDeps as (args: {
  search: { operator?: string | undefined }
}) => { operator: string | undefined }
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
}) => Promise<unknown>

describe('locations route loader', () => {
  it('threads the operator search param through loaderDeps so a context switch refetches', () => {
    expect(loaderDeps({ search: { operator: 'op_9' } })).toEqual({ operator: 'op_9' })
    expect(loaderDeps({ search: {} })).toEqual({ operator: undefined })
  })

  it('prefetches the operator-locations list query scoped to the picked operator', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: 'op_9' } })

    expect(ensureQueryData).toHaveBeenCalledTimes(1)
    const options = ensureQueryData.mock.calls[0][0] as { queryKey: unknown }
    expect(options.queryKey).toEqual(['operator-locations', 'op_9'])
  })

  it('defaults the list key to the all-scope when no operator is picked', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } }, deps: { operator: undefined } })

    const options = ensureQueryData.mock.calls[0][0] as { queryKey: unknown }
    expect(options.queryKey).toEqual(['operator-locations', 'all'])
  })
})

describe('locations route placement', () => {
  // Guard AC (#529): the page must sit under the `_business` pathless layout so
  // its membership guard runs. The generated tree encodes the parent in the
  // route id — if anyone moves the file out of `_business`, this id vanishes.
  it('is registered under the _business guard with a clean /manage/locations URL', () => {
    const tree = readFileSync(resolve(process.cwd(), 'src/routeTree.gen.ts'), 'utf8')
    expect(tree).toContain("'/$locale/_business/manage/locations'")
    expect(tree).toContain("'/$locale/manage/locations'")
  })
})
