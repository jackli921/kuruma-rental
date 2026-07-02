import type { FeeScheduleData } from '@kuruma/shared/types/fee-schedule'
import type { InsuranceOptionData } from '@kuruma/shared/types/insurance-option'
import { expect, test } from 'vitest'
import type { FeeSchedule, InsuranceOption } from './stores'

// #847: the operator fee/insurance routes return their store row verbatim
// (`ok(c, row)`); Hono's `c.json` renders Date columns as ISO strings and leaves
// every other field untouched. `Jsonified` mirrors that single transform, so it
// is the exact wire shape the web client receives.
//
// Catalog i18n (slice 2): the ADD-ON fence is retired here. Its operator DTO is
// now a hand-projected service model (resolvedName/resolvedDescription, no raw
// `name` column), so the read can no longer be a verbatim row and
// `Jsonified<AddOn>` can no longer equal the DTO — it moves to the web-side
// `satisfies` pin like the storefront projections (#864).
//
// `JsonifiedValue` takes V as a naked type parameter so the conditional
// distributes over unions: a future `Date | null` column maps to `string | null`,
// not back to `Date | null` (an inline `T[K] extends Date` would NOT distribute).
type JsonifiedValue<V> = V extends Date ? string : V
type Jsonified<T> = { [K in keyof T]: JsonifiedValue<T[K]> }

// Bidirectional assignability == structural equality. The web schemas pin to the
// shared `*Data` DTOs with `satisfies z.ZodType<T>`; this fences the producer end
// to the SAME contract. If a store row type (and ultimately the Drizzle table it
// mirrors) gains, renames, or retypes a field, one direction stops compiling —
// forcing the shared DTO, and therefore the web schema, to move in lockstep.
// That closes the last fee/add-on/insurance runtime-only seam to compile time:
// drift now fails `typecheck` instead of surfacing as a render-time ParseError.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const feeContract: Exact<Jsonified<FeeSchedule>, FeeScheduleData> = true
const insuranceContract: Exact<Jsonified<InsuranceOption>, InsuranceOptionData> = true

test('fee/insurance wire DTOs equal the JSON shape of their API row types', () => {
  // The assignments above are the real check (resolved by tsc). Asserting them at
  // runtime keeps the fence in the suite, so a `never` collapse fails loudly here
  // too rather than only in a separate typecheck step.
  expect([feeContract, insuranceContract]).toEqual([true, true])
})
