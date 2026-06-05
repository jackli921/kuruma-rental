import { createApiClient } from '@/lib/api-client'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type {
  CreateInsuranceOptionInput,
  UpdateInsuranceOptionInput,
} from '@kuruma/shared/validators/insurance-option'

// JSON-serialized InsuranceOption — dates come as ISO strings from the API.
export interface InsuranceOptionData {
  id: string
  operatorId: string
  name: string
  description: string | null
  dailyPriceJpy: number
  deductibleJpy: number | null
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

export async function fetchInsuranceOptions(
  options: ListOptions = {},
  token?: string,
): Promise<InsuranceOptionData[]> {
  const client = createApiClient(token)
  const query: Record<string, string> = {}
  if (options.status) query.status = options.status
  if (options.includeArchived) query.includeArchived = 'true'
  const res = await client['insurance-options'].$get(
    Object.keys(query).length > 0 ? { query } : undefined,
  )
  return unwrap<InsuranceOptionData[]>(res)
}

export async function createInsuranceOption(
  data: CreateInsuranceOptionInput,
  token?: string,
): Promise<InsuranceOptionData> {
  const client = createApiClient(token)
  const res = await client['insurance-options'].$post({ json: data })
  return unwrap<InsuranceOptionData>(res)
}

// Raw fetch for PATCH — hc client used only for typed URL construction
// (mirrors updateLocation; the routes parse the body manually).
export async function updateInsuranceOption(
  id: string,
  data: UpdateInsuranceOptionInput,
  token?: string,
): Promise<InsuranceOptionData> {
  const client = createApiClient()
  const url = client['insurance-options'][':id'].$url({ param: { id } })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(data) })
  return unwrap<InsuranceOptionData>(res)
}

// API DELETE performs a soft archive (status → ARCHIVED). Name reflects the
// semantic, not the HTTP verb.
export async function archiveInsuranceOption(
  id: string,
  token?: string,
): Promise<InsuranceOptionData> {
  const client = createApiClient(token)
  const res = await client['insurance-options'][':id'].$delete({ param: { id } })
  return unwrap<InsuranceOptionData>(res)
}
