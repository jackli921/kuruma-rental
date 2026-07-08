import { describe, expect, it } from 'vitest'
import { type RovingBar, buildRovingModel, nextBarId } from './timeline-roving'

// #1470: pure 2D-grid navigation over the interactive timeline bars. Rows are the fleet
// vehicles in board order; within a row bars are ordered by start. Left/Right walk a row;
// Up/Down jump to the temporally-nearest bar in the adjacent NON-EMPTY row; Home/End hit the
// row ends; every direction clamps at the board edge (no wrap). This is the whole nav model —
// the shell only turns a key into a direction and focuses the returned id.

const bar = (id: string, group: string, start: number): RovingBar => ({ id, group, start })

describe('buildRovingModel', () => {
  it('orders interactive bars row-major, then by start within a row', () => {
    const m = buildRovingModel(
      ['v1', 'v2'],
      [bar('b', 'v1', 200), bar('a', 'v1', 100), bar('c', 'v2', 50)],
    )
    expect(m.order).toEqual(['a', 'b', 'c'])
  })

  it('drops rows with no interactive bars, so nav never lands on an empty row', () => {
    // v2 is empty; a Down from v1 must skip it and reach v3.
    const m = buildRovingModel(['v1', 'v2', 'v3'], [bar('a', 'v1', 100), bar('c', 'v3', 120)])
    expect(nextBarId(m, 'a', 'down')).toBe('c')
  })
})

describe('nextBarId — within a row (left/right/home/end)', () => {
  const m = buildRovingModel(
    ['v1'],
    [bar('a', 'v1', 100), bar('b', 'v1', 200), bar('c', 'v1', 300)],
  )

  it('right moves to the next bar by start', () => expect(nextBarId(m, 'a', 'right')).toBe('b'))
  it('left moves to the previous bar by start', () => expect(nextBarId(m, 'b', 'left')).toBe('a'))
  it('right clamps at the last bar (no wrap)', () => expect(nextBarId(m, 'c', 'right')).toBe('c'))
  it('left clamps at the first bar (no wrap)', () => expect(nextBarId(m, 'a', 'left')).toBe('a'))
  it('home jumps to the first bar in the row', () => expect(nextBarId(m, 'b', 'home')).toBe('a'))
  it('end jumps to the last bar in the row', () => expect(nextBarId(m, 'b', 'end')).toBe('c'))
})

describe('nextBarId — across rows (up/down, nearest in time)', () => {
  // v1: a@100 b@500 ; v2: c@120 d@480
  const m = buildRovingModel(
    ['v1', 'v2'],
    [bar('a', 'v1', 100), bar('b', 'v1', 500), bar('c', 'v2', 120), bar('d', 'v2', 480)],
  )

  it('down lands on the temporally nearest bar in the next row', () => {
    expect(nextBarId(m, 'a', 'down')).toBe('c') // |100-120|=20 < |100-480|=380
    expect(nextBarId(m, 'b', 'down')).toBe('d') // |500-480|=20 < |500-120|=380
  })

  it('up is symmetric with down', () => {
    expect(nextBarId(m, 'd', 'up')).toBe('b')
    expect(nextBarId(m, 'c', 'up')).toBe('a')
  })

  it('down clamps at the last row', () => expect(nextBarId(m, 'c', 'down')).toBe('c'))
  it('up clamps at the first row', () => expect(nextBarId(m, 'a', 'up')).toBe('a'))

  it('breaks a nearest-in-time tie toward the earlier-starting bar', () => {
    // From x@100; both p@50 and q@150 are 50ms away — prefer the earlier start (p).
    const mm = buildRovingModel(
      ['v1', 'v2'],
      [bar('x', 'v1', 100), bar('p', 'v2', 50), bar('q', 'v2', 150)],
    )
    expect(nextBarId(mm, 'x', 'down')).toBe('p')
  })
})

describe('nextBarId — defensive', () => {
  const m = buildRovingModel(['v1'], [bar('a', 'v1', 100)])

  it('returns the first bar in order for an unknown current id', () => {
    expect(nextBarId(m, 'ghost', 'right')).toBe('a')
  })
})
