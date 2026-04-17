'use server'

import { createApiClient } from '@/lib/api-client'
import { getApiToken } from '@/lib/api-token'
import type { ApiResponse } from '@kuruma/shared/types/api-response'

export type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

interface CustomerData {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  language: string
}

// Generic caught-error handler. Logs for Cloudflare Worker traces (so
// real failures aren't silently mapped to "Network error") then returns
// the user-facing message. Caller decides the string.
function handleCaught(err: unknown, fallback: string): { success: false; error: string } {
  console.error(err)
  return { success: false, error: fallback }
}

export async function searchCustomers(query: string): Promise<ActionResult<CustomerData[]>> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  try {
    const client = createApiClient(token)
    const res = await client.customers.search.$get({ query: { q: query } })
    const body = (await res.json()) as ApiResponse<CustomerData[]>
    if (!body.success) return { success: false, error: body.error ?? 'Search failed' }
    return { success: true, data: body.data }
  } catch (err) {
    return handleCaught(err, 'Network error')
  }
}

export async function quickCreateCustomer(input: {
  name: string
  email?: string
  phone?: string
  language?: string
}): Promise<ActionResult<CustomerData>> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  try {
    const client = createApiClient(token)
    const res = await client.customers['quick-create'].$post({ json: input })
    const body = (await res.json()) as ApiResponse<CustomerData>
    if (!body.success) return { success: false, error: body.error ?? 'Create failed' }
    return { success: true, data: body.data }
  } catch (err) {
    return handleCaught(err, 'Network error')
  }
}

export async function createManualBooking(input: {
  vehicleId: string
  renterId: string
  startAt: string
  endAt: string
  notes?: string
}): Promise<ActionResult<{ id: string }>> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  try {
    const client = createApiClient(token)
    const res = await client.bookings.$post({
      json: {
        vehicleId: input.vehicleId,
        startAt: input.startAt,
        endAt: input.endAt,
        notes: input.notes,
        source: 'MANUAL' as const,
        renterId: input.renterId,
        idempotencyKey: crypto.randomUUID(),
      },
    })
    const body = (await res.json()) as ApiResponse<{ id: string }>
    if (!body.success) return { success: false, error: body.error ?? 'Booking failed' }
    return { success: true, data: body.data }
  } catch (err) {
    return handleCaught(err, 'Network error')
  }
}

// Availability stays on raw fetch because the API route reads `from`/`to`
// via c.req.query() directly (no zValidator), so the typed Hono client
// doesn't carry them. URL construction is still type-safe via $url().
export async function checkAvailability(
  vehicleId: string,
  from: string,
  to: string,
): Promise<ActionResult<{ available: boolean }>> {
  const token = await getApiToken()
  if (!token) return { success: false, error: 'Authentication required' }

  try {
    const client = createApiClient(token)
    const url = client.availability[':vehicleId'].$url({ param: { vehicleId } })
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as ApiResponse<{ available: boolean }>
    if (!body.success) return { success: false, error: body.error ?? 'Check failed' }
    return { success: true, data: body.data }
  } catch (err) {
    return handleCaught(err, 'Network error')
  }
}
