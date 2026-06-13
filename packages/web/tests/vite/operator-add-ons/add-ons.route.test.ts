import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '@/routes/$locale/_business/manage/add-ons'
import { describe, expect, it, vi } from 'vitest'

// The loader's only job is to prefetch the add-on list into the query cache so
// the component's useSuspenseQuery resolves without a FOUC. (The api helpers it
// composes are covered in api.test.ts.)
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
}) => Promise<unknown>

describe('add-ons route loader', () => {
  it('prefetches the operator-add-ons list query', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({ context: { queryClient: { ensureQueryData } } })

    expect(ensureQueryData).toHaveBeenCalledTimes(1)
    const options = ensureQueryData.mock.calls[0][0] as { queryKey: unknown }
    expect(options.queryKey).toEqual(['operator-add-ons'])
  })
})

describe('add-ons route placement', () => {
  // Guard AC (#585): the page must sit under the `_business` pathless layout so
  // its membership guard runs. The generated tree encodes the parent in the
  // route id — if anyone moves the file out of `_business`, this id vanishes.
  it('is registered under the _business guard with a clean /manage/add-ons URL', () => {
    const tree = readFileSync(resolve(process.cwd(), 'src/routeTree.gen.ts'), 'utf8')
    expect(tree).toContain("'/$locale/_business/manage/add-ons'")
    expect(tree).toContain("'/$locale/manage/add-ons'")
  })
})
