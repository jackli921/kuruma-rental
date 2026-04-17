'use server'

import { createApiClient } from '@/lib/api-client'
import { getApiToken } from '@/lib/api-token'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { Customer, CustomerWithBookings } from '@kuruma/shared/types/customer'

export interface ListCustomersArgs {
  search?: string
  sort?: 'lastBookingAt' | 'bookingCount' | 'name'
  cursor?: string
  limit?: number
}

export interface ListCustomersResult {
  customers: Customer[]
  nextCursor: string | null
}

export async function listCustomers(args: ListCustomersArgs = {}): Promise<ListCustomersResult> {
  const token = await getApiToken()
  const client = createApiClient(token)
  const query: Record<string, string> = {}
  if (args.search) query.search = args.search
  if (args.sort) query.sort = args.sort
  if (args.cursor) query.cursor = args.cursor
  if (args.limit) query.limit = String(args.limit)

  const res = await client.customers.$get({ query })
  const json = (await res.json()) as ApiResponse<Customer[]> & { nextCursor?: string | null }

  if (!json.success) return { customers: [], nextCursor: null }
  return { customers: json.data, nextCursor: json.nextCursor ?? null }
}

export async function getCustomerById(id: string): Promise<CustomerWithBookings | null> {
  const token = await getApiToken()
  const client = createApiClient(token)
  const res = await client.customers[':id'].$get({ param: { id } })
  const json = (await res.json()) as ApiResponse<CustomerWithBookings>

  if (!json.success) return null
  return json.data
}
