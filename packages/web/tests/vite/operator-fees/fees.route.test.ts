import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '@/routes/$locale/_business/manage/fees'
import { describe, expect, it, vi } from 'vitest'

// The loader prefetches BOTH the fee list and the operator-scoped vehicle
// classes (#528) into the query cache, so the component's useSuspenseQuery
// resolves without a FOUC and the class dropdown is fed scoped classes.
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
}) => Promise<unknown>

describe('fees route loader', () => {
  it('prefetches the fee list AND the operator-scoped classes', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } } })

    expect(ensureQueryData).toHaveBeenCalledTimes(2)
    const keys = ensureQueryData.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
    expect(keys).toContainEqual(['operator-fees'])
    // The operator-scoped class endpoint (#528), NOT the public catalog.
    expect(keys).toContainEqual(['operator-classes', false])
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
