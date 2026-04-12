import { describe, expect, test } from 'bun:test'
import { checkFiles } from './lint-file-size'

const FIXTURES = 'scripts/__fixtures__/lint'

describe('lint-file-size', () => {
  test('reports a hard failure for a file over 800 lines', () => {
    const report = checkFiles([`${FIXTURES}/big-file.ts`])
    const errors = report.filter((r) => r.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]!.file).toBe(`${FIXTURES}/big-file.ts`)
    expect(errors[0]!.lines).toBe(900)
    expect(errors[0]!.cap).toBe(800)
  })

  test('does not report a small file', () => {
    const report = checkFiles([`${FIXTURES}/small-file.ts`])
    expect(report).toHaveLength(0)
  })
})
