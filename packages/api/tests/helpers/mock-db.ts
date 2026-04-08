/**
 * In-memory mock for Drizzle's getDb() that supports the fluent query API
 * used by our Hono routes. Backed by simple arrays, reset between tests.
 *
 * Supports: select/from/where, insert/values/returning, update/set/where/returning
 * Filters: eq, and, or, gte, lte, lt, gt from drizzle-orm are intercepted
 * at the mock level via a predicate-based approach.
 */
import { vi } from 'vitest'

// ---------- Storage ----------

type Row = Record<string, unknown>

const tables = new Map<string, Row[]>()

/**
 * Drizzle tables store their name in a Symbol(drizzle:Name) property.
 * We need to extract it for our in-memory mock.
 */
function resolveTableName(tableRef: unknown): string {
  if (typeof tableRef === 'string') return tableRef

  if (typeof tableRef === 'object' && tableRef !== null) {
    // Check for Symbol(drizzle:Name)
    const nameSymbol = Object.getOwnPropertySymbols(tableRef).find(
      (s) => s.toString() === 'Symbol(drizzle:Name)',
    )
    if (nameSymbol) {
      return (tableRef as Record<symbol, string>)[nameSymbol]
    }

    // Fallback: check for _.name pattern (some Drizzle versions)
    if ('_' in tableRef) {
      const meta = (tableRef as Record<string, unknown>)._
      if (typeof meta === 'object' && meta !== null && 'name' in meta) {
        return (meta as { name: string }).name
      }
    }
  }

  throw new Error(`Cannot resolve table name from: ${String(tableRef)}`)
}

function getTable(tableRef: unknown): Row[] {
  const name = resolveTableName(tableRef)
  if (!tables.has(name)) {
    tables.set(name, [])
  }
  return tables.get(name)!
}

export function resetAllTables(): void {
  tables.clear()
}

export function seedTable(tableRef: unknown, rows: Row[]): void {
  const name = resolveTableName(tableRef)
  tables.set(name, [...rows])
}

// ---------- Filter helpers ----------

type FilterPredicate = (row: Row) => boolean

const MOCK_FILTER = Symbol('mockFilter')

interface MockFilter {
  [MOCK_FILTER]: true
  predicate: FilterPredicate
}

function isMockFilter(val: unknown): val is MockFilter {
  return typeof val === 'object' && val !== null && MOCK_FILTER in val
}

function toFilter(val: unknown): FilterPredicate {
  if (val === undefined) return () => true
  if (isMockFilter(val)) return val.predicate
  // If it's something we can't interpret, pass everything
  return () => true
}

function columnName(col: unknown): string {
  // Drizzle column objects have a .name property
  if (typeof col === 'object' && col !== null && 'name' in col) {
    return (col as { name: string }).name
  }
  return String(col)
}

/**
 * Mock-friendly replacements for drizzle-orm operators.
 * Each returns a tagged object with a JS predicate that operates on rows.
 */
export function createMockOperators() {
  const eq = (col: unknown, value: unknown): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => row[columnName(col)] === value,
  })

  const and = (...filters: unknown[]): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) =>
      filters.filter((f) => f != null).every((f) => toFilter(f)(row)),
  })

  const or = (...filters: unknown[]): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) =>
      filters.filter((f) => f != null).some((f) => toFilter(f)(row)),
  })

  const gt = (col: unknown, value: unknown): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => (row[columnName(col)] as number) > (value as number),
  })

  const gte = (col: unknown, value: unknown): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => (row[columnName(col)] as number) >= (value as number),
  })

  const lt = (col: unknown, value: unknown): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => (row[columnName(col)] as number) < (value as number),
  })

  const lte = (col: unknown, value: unknown): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => (row[columnName(col)] as number) <= (value as number),
  })

  const inArray = (col: unknown, values: unknown[]): MockFilter => ({
    [MOCK_FILTER]: true,
    predicate: (row) => (values as unknown[]).includes(row[columnName(col)]),
  })

  return { eq, and, or, gt, gte, lt, lte, inArray }
}

// ---------- Mock DB builder ----------

function createMockDb() {
  return {
    select() {
      let targetTable: string | undefined
      let filter: FilterPredicate = () => true

      const chain = {
        from(table: unknown) {
          targetTable = resolveTableName(table)
          return chain
        },
        where(condition: unknown) {
          filter = toFilter(condition)
          return chain
        },
        then(
          resolve: (val: Row[]) => void,
          _reject?: (err: unknown) => void,
        ) {
          const rows = targetTable ? getTable(targetTable) : []
          resolve(rows.filter(filter))
        },
      }

      return chain
    },

    insert(table: unknown) {
      const tableName = resolveTableName(table)
      let rowsToInsert: Row[] = []

      return {
        values(data: Row | Row[]) {
          rowsToInsert = Array.isArray(data) ? data : [data]
          return {
            returning() {
              const tableData = getTable(tableName)
              const inserted = rowsToInsert.map((row) => {
                const newRow = { ...row }
                if (!newRow.id) {
                  newRow.id = crypto.randomUUID()
                }
                if (!newRow.createdAt) {
                  newRow.createdAt = new Date().toISOString()
                }
                if (!newRow.updatedAt) {
                  newRow.updatedAt = new Date().toISOString()
                }
                tableData.push(newRow)
                return newRow
              })

              return {
                then(
                  resolve: (val: Row[]) => void,
                  _reject?: (err: unknown) => void,
                ) {
                  resolve(inserted)
                },
              }
            },
            then(
              resolve: (val: undefined) => void,
              _reject?: (err: unknown) => void,
            ) {
              const tableData = getTable(tableName)
              for (const row of rowsToInsert) {
                const newRow = { ...row }
                if (!newRow.id) newRow.id = crypto.randomUUID()
                tableData.push(newRow)
              }
              resolve(undefined)
            },
          }
        },
      }
    },

    update(table: unknown) {
      const tableName = resolveTableName(table)

      return {
        set(data: Row) {
          const setData = data
          return {
            where(condition: unknown) {
              const filter = toFilter(condition)
              return {
                returning() {
                  return {
                    then(
                      resolve: (val: Row[]) => void,
                      _reject?: (err: unknown) => void,
                    ) {
                      const tableData = getTable(tableName)
                      const updated: Row[] = []
                      for (let i = 0; i < tableData.length; i++) {
                        if (filter(tableData[i])) {
                          tableData[i] = { ...tableData[i], ...setData }
                          updated.push(tableData[i])
                        }
                      }
                      resolve(updated)
                    },
                  }
                },
                then(
                  resolve: (val: undefined) => void,
                  _reject?: (err: unknown) => void,
                ) {
                  const tableData = getTable(tableName)
                  for (let i = 0; i < tableData.length; i++) {
                    if (filter(tableData[i])) {
                      tableData[i] = { ...tableData[i], ...setData }
                    }
                  }
                  resolve(undefined)
                },
              }
            },
          }
        },
      }
    },

    delete(table: unknown) {
      const tableName = resolveTableName(table)

      return {
        where(condition: unknown) {
          const filter = toFilter(condition)
          return {
            returning() {
              return {
                then(
                  resolve: (val: Row[]) => void,
                  _reject?: (err: unknown) => void,
                ) {
                  const tableData = getTable(tableName)
                  const deleted: Row[] = []
                  const remaining: Row[] = []
                  for (const row of tableData) {
                    if (filter(row)) {
                      deleted.push(row)
                    } else {
                      remaining.push(row)
                    }
                  }
                  tables.set(tableName, remaining)
                  resolve(deleted)
                },
              }
            },
            then(
              resolve: (val: undefined) => void,
              _reject?: (err: unknown) => void,
            ) {
              const tableData = getTable(tableName)
              tables.set(
                tableName,
                tableData.filter((row) => !filter(row)),
              )
              resolve(undefined)
            },
          }
        },
      }
    },
  }
}

// ---------- Setup vitest mocks ----------

const mockDb = createMockDb()
const mockOperators = createMockOperators()

/**
 * Call this in your test file BEFORE any imports of route code.
 * Uses vi.mock to intercept both @kuruma/shared/db and drizzle-orm.
 */
export function setupDbMocks(): void {
  vi.mock('@kuruma/shared/db', () => ({
    getDb: () => mockDb,
  }))

  vi.mock('drizzle-orm', () => mockOperators)
}

export { mockDb }
