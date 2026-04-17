'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type VehicleClassData,
  archiveClass,
  createClass,
  fetchClasses,
  updateClass,
} from '@/modules/classes/api'
import type {
  CreateVehicleClassInput,
  UpdateVehicleClassInput,
} from '@kuruma/shared/validators/vehicle-class'

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

export async function fetchClassesAction(options?: {
  includeArchived?: boolean
}): Promise<ActionResult<VehicleClassData[]>> {
  return withAuth((token) => fetchClasses(options ?? {}, token))
}

export async function createClassAction(
  data: CreateVehicleClassInput,
): Promise<ActionResult<VehicleClassData>> {
  return withAuth((token) => createClass(data, token))
}

export async function updateClassAction(
  id: string,
  data: UpdateVehicleClassInput,
): Promise<ActionResult<VehicleClassData>> {
  return withAuth((token) => updateClass(id, data, token))
}

export async function archiveClassAction(id: string): Promise<ActionResult<VehicleClassData>> {
  return withAuth((token) => archiveClass(id, token))
}
