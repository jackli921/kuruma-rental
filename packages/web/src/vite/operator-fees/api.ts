import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type {
  CreateFeeScheduleInput,
  FeeType,
  FeeUnit,
  UpdateFeeScheduleInput,
} from '@kuruma/shared/validators/fee-schedule'
import { queryOptions } from '@tanstack/react-query'

// #530: operator fee-schedule management. Mirrors the operator-insurance data
// layer — cookie-based, operator-scoped server-side (the client passes no
// operatorId), writes thread the session CSRF token. Canonical write types come
// from @kuruma/shared so the form stays in lockstep with the Zod validators.

export type { CreateFeeScheduleInput, UpdateFeeScheduleInput, FeeType, FeeUnit }

/** JSON-serialized FeeSchedule — dates arrive as ISO strings from the API. */
export interface FeeScheduleData {
  id: string
  operatorId: string
  /** null = operator-wide; otherwise scoped to a single vehicle class. */
  vehicleClassId: string | null
  feeType: FeeType
  unit: FeeUnit
  amountJpy: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

export const FEE_QUERY_KEY = ['operator-fees'] as const

// Management lists archived rows too (badged + restorable), so the fetch is
// parameterless and the query key stays stable for invalidation.
export async function fetchFeeSchedules(): Promise<FeeScheduleData[]> {
  const res = await fetch(`${getApiBaseUrl()}/fee-schedules?includeArchived=true`, {
    credentials: 'include',
  })
  return unwrap<FeeScheduleData[]>(res)
}

export function feeSchedulesQueryOptions() {
  return queryOptions({
    queryKey: FEE_QUERY_KEY,
    queryFn: fetchFeeSchedules,
  })
}

// --- Mutations (cookie-based, CSRF-gated) ------------------------------------

async function writeJson<T>(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap<T>(res)
}

export async function createFeeSchedule(
  input: CreateFeeScheduleInput,
  csrfToken: string,
): Promise<FeeScheduleData> {
  return writeJson<FeeScheduleData>('/fee-schedules', 'POST', input, csrfToken)
}

export async function updateFeeSchedule(
  id: string,
  input: UpdateFeeScheduleInput,
  csrfToken: string,
): Promise<FeeScheduleData> {
  return writeJson<FeeScheduleData>(
    `/fee-schedules/${encodeURIComponent(id)}`,
    'PATCH',
    input,
    csrfToken,
  )
}

// Soft-archive (DELETE flips status to ARCHIVED). The CSRF header still rides
// along because a cookie-authed DELETE is a mutation the guard protects.
export async function archiveFeeSchedule(id: string, csrfToken: string): Promise<FeeScheduleData> {
  const res = await fetch(`${getApiBaseUrl()}/fee-schedules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap<FeeScheduleData>(res)
}
