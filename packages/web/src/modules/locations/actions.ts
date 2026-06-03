'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type LocationData,
  archiveLocation,
  createLocation,
  fetchLocations,
  updateLocation,
} from '@/modules/locations/api'
import type { CreateLocationInput, UpdateLocationInput } from '@kuruma/shared/validators/location'

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<ActionResult<T>> {
  const token = await getApiToken()
  if (!token) {
    return { success: false, error: 'Authentication required' }
  }
  try {
    const data = await fn(token)
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'An error occurred' }
  }
}

export async function fetchLocationsAction(options?: {
  includeArchived?: boolean
}): Promise<ActionResult<LocationData[]>> {
  return withAuth((token) => fetchLocations(options ?? {}, token))
}

export async function createLocationAction(
  data: CreateLocationInput,
): Promise<ActionResult<LocationData>> {
  return withAuth((token) => createLocation(data, token))
}

export async function updateLocationAction(
  id: string,
  data: UpdateLocationInput,
): Promise<ActionResult<LocationData>> {
  return withAuth((token) => updateLocation(id, data, token))
}

export async function archiveLocationAction(id: string): Promise<ActionResult<LocationData>> {
  return withAuth((token) => archiveLocation(id, token))
}
