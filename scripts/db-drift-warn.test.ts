import { describe, expect, test } from 'bun:test'
import { assessDrift, formatDriftWarning } from './db-drift-warn'

describe('assessDrift', () => {
  test('behind when the DB has applied fewer migrations than the journal', () => {
    expect(assessDrift({ journal: 59, applied: 54 })).toEqual({
      kind: 'behind',
      pending: 5,
      journal: 59,
      applied: 54,
    })
  })

  test('in-sync when applied count equals journal count', () => {
    expect(assessDrift({ journal: 59, applied: 59 })).toEqual({ kind: 'in-sync' })
  })

  test('ahead when the DB has applied more migrations than this worktree knows', () => {
    expect(assessDrift({ journal: 54, applied: 59 })).toEqual({
      kind: 'ahead',
      journal: 54,
      applied: 59,
    })
  })

  test('a fresh/empty DB (0 applied) is behind by the full journal count', () => {
    expect(assessDrift({ journal: 59, applied: 0 })).toEqual({
      kind: 'behind',
      pending: 59,
      journal: 59,
      applied: 0,
    })
  })
})

describe('formatDriftWarning', () => {
  test('behind → loud warning naming the pending count and the exact fix command', () => {
    const msg = formatDriftWarning({ kind: 'behind', pending: 5, journal: 59, applied: 54 })
    expect(msg).toContain('5 migration')
    expect(msg).toContain('bun run db:migrate')
  })

  test('in-sync → no warning (null) so dev startup stays quiet', () => {
    expect(formatDriftWarning({ kind: 'in-sync' })).toBeNull()
  })

  test('ahead → silent (null): a DB ahead of the worktree is benign, so avoid alarm fatigue', () => {
    expect(formatDriftWarning({ kind: 'ahead', journal: 54, applied: 59 })).toBeNull()
  })
})
