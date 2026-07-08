// #1470 fleet timeline roving-tabindex nav: pure 2D-grid geometry over the board's
// INTERACTIVE bars. A dense board is ~100-200 focusable bars (#1349 made each its own
// tab stop); a roving tabindex collapses that to one stop with arrow-key movement inside.
// This module is the whole navigation model — given the board's rows and a current bar +
// direction, it returns the bar to focus next. Kept free of React and the lib (FC/IS: the
// FleetTimeline shell does the imperative focus; this decides where focus goes).

/** An arrow/Home/End keypress, already resolved to a board direction by the shell. */
export type RovingDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end'

/** The minimal shape the nav needs from a bar: its id, its row (vehicle group), and its
 *  start instant (epoch ms) — the temporal coordinate Up/Down navigates by. */
export interface RovingBar {
  readonly id: string
  readonly group: string
  readonly start: number
}

interface RovingCell {
  readonly id: string
  readonly start: number
}

interface RovingRow {
  readonly group: string
  readonly bars: readonly RovingCell[]
}

interface RovingPosition {
  readonly rowIndex: number
  readonly colIndex: number
  readonly start: number
}

export interface RovingModel {
  /** Interactive bar ids in reading order (row order, then start asc). `order[0]` is the
   *  default roving stop when nothing is focused yet. */
  readonly order: readonly string[]
  /** Board rows in visual order, EMPTY rows omitted so Up/Down never lands on nothing. */
  readonly rows: readonly RovingRow[]
  readonly posById: ReadonlyMap<string, RovingPosition>
}

const byStartThenId = (a: RovingCell, b: RovingCell): number =>
  a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Build the nav model from the board's group order and its interactive bars. Rows follow
 *  the visual (vehicle) order; a group with no bars is dropped so it is invisible to nav. */
export function buildRovingModel(
  groupOrder: readonly string[],
  bars: readonly RovingBar[],
): RovingModel {
  const cellsByGroup = new Map<string, RovingCell[]>()
  for (const b of bars) {
    const cells = cellsByGroup.get(b.group) ?? []
    cells.push({ id: b.id, start: b.start })
    cellsByGroup.set(b.group, cells)
  }

  const rows: RovingRow[] = []
  for (const group of groupOrder) {
    const cells = cellsByGroup.get(group)
    if (!cells || cells.length === 0) continue
    rows.push({ group, bars: [...cells].sort(byStartThenId) })
  }

  const posById = new Map<string, RovingPosition>()
  const order: string[] = []
  rows.forEach((row, rowIndex) => {
    row.bars.forEach((cell, colIndex) => {
      posById.set(cell.id, { rowIndex, colIndex, start: cell.start })
      order.push(cell.id)
    })
  })

  return { order, rows, posById }
}

/** The bar in `row` whose start is closest to `start`; ties break toward the earlier start,
 *  then the lower id (stable). Null for a missing/empty row so the caller can clamp. */
function nearestInRow(rows: readonly RovingRow[], rowIndex: number, start: number): string | null {
  const row = rows[rowIndex]
  if (!row || row.bars.length === 0) return null
  const sorted = [...row.bars].sort(
    (a, b) =>
      Math.abs(a.start - start) - Math.abs(b.start - start) ||
      a.start - b.start ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return sorted[0]?.id ?? null
}

/** The bar to focus after pressing `dir` while on `currentId`. Clamps at every board edge
 *  (returns `currentId`). An unknown `currentId` resets to the first bar in reading order. */
export function nextBarId(model: RovingModel, currentId: string, dir: RovingDirection): string {
  const pos = model.posById.get(currentId)
  if (!pos) return model.order[0] ?? currentId
  const row = model.rows[pos.rowIndex]
  if (!row) return currentId

  switch (dir) {
    case 'right':
      return row.bars[pos.colIndex + 1]?.id ?? currentId
    case 'left':
      return row.bars[pos.colIndex - 1]?.id ?? currentId
    case 'home':
      return row.bars[0]?.id ?? currentId
    case 'end':
      return row.bars[row.bars.length - 1]?.id ?? currentId
    case 'down':
      return nearestInRow(model.rows, pos.rowIndex + 1, pos.start) ?? currentId
    case 'up':
      return nearestInRow(model.rows, pos.rowIndex - 1, pos.start) ?? currentId
  }
}
