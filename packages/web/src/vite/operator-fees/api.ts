import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import { FEE_SCHEDULE_STATUSES, FEE_TYPES, FEE_UNITS } from '@kuruma/shared/enums'
import type { FeeScheduleData } from '@kuruma/shared/types/fee-schedule'
import type {
  CreateFeeScheduleInput,
  FeeType,
  FeeUnit,
  UpdateFeeScheduleInput,
} from '@kuruma/shared/validators/fee-schedule'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #530: operator fee-schedule management. Mirrors the operator-insurance data
// layer — cookie-based, operator-scoped server-side (the client passes no
// operatorId), writes thread the session CSRF token. Canonical write types come
// from @kuruma/shared so the form stays in lockstep with the Zod validators.

export type { CreateFeeScheduleInput, UpdateFeeScheduleInput, FeeType, FeeUnit }

// JSON-serialized FeeSchedule — dates arrive as ISO strings. Pinned to the shared
// wire DTO with `satisfies` (#847) so a producer-side field drift fails to compile
// here, not silently as a runtime ParseError. The API row type is fenced to the
// same DTO in api `wire-contract.test.ts`, closing the seam at both ends.
const feeScheduleSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  // null = operator-wide; otherwise scoped to a single vehicle class.
  vehicleClassId: z.string().nullable(),
  feeType: z.enum(FEE_TYPES),
  unit: z.enum(FEE_UNITS),
  amountJpy: z.number(),
  status: z.enum(FEE_SCHEDULE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<FeeScheduleData>
export type { FeeScheduleData }

export const FEE_QUERY_KEY = ['operator-fees'] as const

// Management always lists archived rows too (badged + restorable). The scope
// param is `operatorId=<picked>` when an admin has picked a tenant, else
// `includeAll=true` (the bypass-role read default that an operator session
// ignores — it auto-scopes server-side). The bare read previously sent NO scope
// param, which 400'd a PLATFORM_ADMIN's cross-operator read (the #529 lesson).
export async function fetchFeeSchedules(pickedOperatorId?: string): Promise<FeeScheduleData[]> {
  const res = await fetch(
    `${getApiBaseUrl()}/fee-schedules?includeArchived=true&${buildScopeParam(pickedOperatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, feeScheduleSchema.array())
}

// The picked operator id is part of the cache key so switching context refetches
// (and never serves another tenant's cached list). Optional param keeps any
// no-arg caller working.
export function feeSchedulesQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...FEE_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchFeeSchedules(pickedOperatorId),
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------

async function writeJson(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<FeeScheduleData> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, feeScheduleSchema)
}

// #1442: a picker admin stamps the picked operatorId into the create BODY (the API
// requires it for a bypass caller); an operator session omits it (server ignores it).
export async function createFeeSchedule(
  input: WithOperatorId<CreateFeeScheduleInput>,
  csrfToken: string,
): Promise<FeeScheduleData> {
  return writeJson('/fee-schedules', 'POST', input, csrfToken)
}

// #1442: PATCH/DELETE bind to the picked operator via `?operatorId=` (the API 422s a
// bypass caller with no pick, 404s a wrong pick). An operator session omits it and is
// tenant-clamped server-side. Mirrors #1361's updateBookingStatus.
function operatorQuery(pickedOperatorId?: string): string {
  return pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
}

export async function updateFeeSchedule(
  id: string,
  input: UpdateFeeScheduleInput,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<FeeScheduleData> {
  const path = `/fee-schedules/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`
  return writeJson(path, 'PATCH', input, csrfToken)
}

// Soft-archive (DELETE flips status to ARCHIVED). The CSRF header still rides
// along because a cookie-authed DELETE is a mutation the guard protects.
export async function archiveFeeSchedule(
  id: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<FeeScheduleData> {
  const path = `/fee-schedules/${encodeURIComponent(id)}${operatorQuery(pickedOperatorId)}`
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, feeScheduleSchema)
}
