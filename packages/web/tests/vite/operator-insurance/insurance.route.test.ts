import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '@/routes/$locale/_business/manage/insurance'
import { describe, expect, it, vi } from 'vitest'

// The loader's only job is to prefetch the insurance list into the query cache
// so the component's useSuspenseQuery resolves without a FOUC. (The api helpers
// it composes are covered in api.test.ts.) It reads the operator from loaderDeps so
// a context switch refetches, and the `$locale` route param so a language switch
// refetches; with no operator picked the scoped key resolves to 'all'.
const loader = Route.options.loader as (args: {
  context: { queryClient: { ensureQueryData: ReturnType<typeof vi.fn> } }
  deps: { operator: string | undefined }
  params: { locale: string }
}) => Promise<unknown>

describe('insurance route loader', () => {
  it('prefetches the operator-insurance list query scoped to the picked operator and locale', async () => {
    const ensureQueryData = vi.fn().mockResolvedValue([])
    await loader({
      context: { queryClient: { ensureQueryData } },
      deps: { operator: 'op_9' },
      params: { locale: 'ja' },
    })

    expect(ensureQueryData).toHaveBeenCalledTimes(1)
    const options = ensureQueryData.mock.calls[0][0] as { queryKey: unknown }
    expect(options.queryKey).toEqual(['operator-insurance', 'op_9', 'ja'])
  })
})

describe('insurance route placement', () => {
  // Guard AC (#530): the page must sit under the `_business` pathless layout so
  // its membership guard runs. The generated tree encodes the parent in the
  // route id — if anyone moves the file out of `_business`, this id vanishes.
  it('is registered under the _business guard with a clean /manage/insurance URL', () => {
    const tree = readFileSync(resolve(process.cwd(), 'src/routeTree.gen.ts'), 'utf8')
    expect(tree).toContain("'/$locale/_business/manage/insurance'")
    expect(tree).toContain("'/$locale/manage/insurance'")
  })
})
