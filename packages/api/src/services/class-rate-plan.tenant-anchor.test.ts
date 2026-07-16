import { expect, test } from 'vitest'
import type { ClassRatePlanRepository } from '../repositories/types'
import type { ClassRatePlanUpdate } from './class-rate-plan'

// #1558 (M2): the tenant-anchor immutability lint
// (scripts/lint-tenant-anchor-immutability.ts) EXEMPTS `class-rate-plan` from
// its `.set({ ...patch })` ban. That exemption is only safe because the update
// patch types structurally cannot carry `operatorId` — if they could, the
// drizzle `.update(row).set({ ...patch })` spread (and the in-memory twin) could
// silently reassign a row's tenant, the exact regression the lint exists to
// catch. An exemption is a manual promise; these compile-time assertions pin
// that promise so tsc enforces it. Widen either type to include `operatorId`
// (e.g. `Partial<ClassRatePlan>`) and `ExcludesOperatorId<T>` collapses to
// `never`, so `= true` stops compiling under `tsc --noEmit` (this file is in the
// package typecheck `include`) — the unsealed write fails the build before it
// can ship, not the lint that was told to look away.
type ExcludesOperatorId<T> = 'operatorId' extends keyof T ? never : true

// The service-facing update type (services/class-rate-plan.ts).
const serviceUpdateExcludesOperatorId: ExcludesOperatorId<ClassRatePlanUpdate> = true

// The repository interface's `update` patch parameter — the value that actually
// reaches the drizzle `.set({ ...patch })` spread the exemption unblocks.
const repoUpdatePatchExcludesOperatorId: ExcludesOperatorId<
  Parameters<ClassRatePlanRepository['update']>[2]
> = true

test('class-rate-plan update types cannot carry operatorId (tenant-anchor exemption premise)', () => {
  // The assignments above are the real, tsc-resolved checks; asserting them at
  // runtime keeps the fence in the suite so a `never` collapse fails loudly here
  // too, not only in a separate typecheck step.
  expect(serviceUpdateExcludesOperatorId).toBe(true)
  expect(repoUpdatePatchExcludesOperatorId).toBe(true)
})
