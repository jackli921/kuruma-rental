import { describe, expect, test } from 'bun:test'
import { findFrozenFiles } from './lint-no-next-app'

const FIXTURE_ROOT = 'scripts/__fixtures__/no-next-app/app'

describe('lint-no-next-app', () => {
  test('recursively finds .ts/.tsx source files under the frozen tree, ignoring non-source files', () => {
    const found = findFrozenFiles(FIXTURE_ROOT).sort()
    expect(found).toEqual([`${FIXTURE_ROOT}/regrown-page.tsx`, `${FIXTURE_ROOT}/sub/layout.tsx`])
  })

  test('returns empty when the frozen tree directory is absent — the desired post-#704 state', () => {
    const found = findFrozenFiles('scripts/__fixtures__/no-next-app/does-not-exist')
    expect(found).toEqual([])
  })
})
