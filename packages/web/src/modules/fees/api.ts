import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type {
  CreateFeeScheduleInput,
  FeeType,
  FeeUnit,
  UpdateFeeScheduleInput,
} from '@kuruma/shared/validators/fee-schedule'

// Re-exported so module consumers keep importing these from `@/modules/fees/api`;
// the single source of truth is the shared validator's `as const` fee enums.
export type { FeeType, FeeUnit }

// JSON-serialized FeeSchedule — dates come as ISO strings from the API.
export interface FeeScheduleData {
  id: string
  operatorId: string
  vehicleClassId: string | null
  feeType: FeeType
  unit: FeeUnit
  amountJpy: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  updatedAt: string
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<T>

  if (!body.success) {
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }

  return body.data
}

interface ListOptions {
  status?: 'ACTIVE' | 'ARCHIVED'
  includeArchived?: boolean
}

export async function fetchFeeSchedules(
  options: ListOptions = {},
  token?: string,
): Promise<FeeScheduleData[]> {
  const client = createApiClient(token)
  const query: Record<string, string> = {}
  if (options.status) query.status = options.status
  if (options.includeArchived) query.includeArchived = 'true'
  const res = await client['fee-schedules'].$get(
    Object.keys(query).length > 0 ? { query } : undefined,
  )
  return unwrap<FeeScheduleData[]>(res)
}

export async function createFeeSchedule(
  data: CreateFeeScheduleInput,
  token?: string,
): Promise<FeeScheduleData> {
  const client = createApiClient(token)
  const res = await client['fee-schedules'].$post({ json: data })
  return unwrap<FeeScheduleData>(res)
}

// Raw fetch for PATCH — hc client used only for typed URL construction
// (mirrors updateLocation; the fee routes parse the body manually).
export async function updateFeeSchedule(
  id: string,
  data: UpdateFeeScheduleInput,
  token?: string,
): Promise<FeeScheduleData> {
  const client = createApiClient()
  const url = client['fee-schedules'][':id'].$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) })
  return unwrap<FeeScheduleData>(res)
}

// API DELETE performs a soft archive (status → ARCHIVED).
export async function archiveFeeSchedule(id: string, token?: string): Promise<FeeScheduleData> {
  const client = createApiClient(token)
  const res = await client['fee-schedules'][':id'].$delete({ param: { id } })
  return unwrap<FeeScheduleData>(res)
}
