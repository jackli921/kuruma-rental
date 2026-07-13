import type { ClassRatePlanData } from '@kuruma/shared/types/class-rate-plan'
import type { FeeScheduleData } from '@kuruma/shared/types/fee-schedule'
import { expect, test } from 'vitest'
import type { ClassRatePlan, FeeSchedule } from './stores'

// #847: the operator fee route returns its store row verbatim (`ok(c, row)`);
// Hono's `c.json` renders Date columns as ISO strings and leaves every other
// field untouched. `Jsonified` mirrors that single transform, so it is the exact
// wire shape the web client receives.
//
// Catalog i18n: the ADD-ON (slice 2) and INSURANCE (slice 3b) fences are retired
// here. Each operator DTO is now a hand-projected service model (add-on:
// resolvedName/resolvedDescription; insurance: resolvedName, no raw `name`
// column), so the read can no longer be a verbatim row and `Jsonified<row>` can
// no longer equal the DTO — both move to the web-side `satisfies` pin like the
// storefront projections (#864). Only the fee route stays a verbatim row.
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
// That closes the fee runtime-only seam to compile time: drift now fails
// `typecheck` instead of surfacing as a render-time ParseError.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const feeContract: Exact<Jsonified<FeeSchedule>, FeeScheduleData> = true

test('fee wire DTO equals the JSON shape of its API row type', () => {
  // The assignment above is the real check (resolved by tsc). Asserting it at
  // runtime keeps the fence in the suite, so a `never` collapse fails loudly here
  // too rather than only in a separate typecheck step.
  expect(feeContract).toBe(true)
})

// #464: class-rate-plan route returns its store row verbatim (`ok(c, row)`).
// Fences the ClassRatePlan store row to the ClassRatePlanData wire DTO so any
// field drift (rename, retype, add, remove) fails to compile at both producer
// and consumer ends.
const classRatePlanContract: Exact<Jsonified<ClassRatePlan>, ClassRatePlanData> = true

test('ClassRatePlan wire row matches ClassRatePlanData', () => {
  expect(classRatePlanContract).toBe(true)
})
