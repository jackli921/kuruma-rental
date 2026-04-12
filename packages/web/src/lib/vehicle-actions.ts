'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type FleetVehicleOverviewData,
  type VehicleData,
  createVehicle,
  fetchFleetOverview,
  retireVehicle,
  updateVehicle,
  updateVehicleStatus,
} from '@/lib/vehicle-api'
import type { CreateVehicleInput, VehicleStatus } from '@kuruma/shared/validators/vehicle'

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

export function fetchFleetOverviewAction(): Promise<ActionResult<FleetVehicleOverviewData[]>> {
  return withAuth((token) => fetchFleetOverview(token))
}

export function createVehicleAction(data: CreateVehicleInput): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => createVehicle(data, token))
}

export function updateVehicleAction(
  id: string,
  data: Partial<CreateVehicleInput>,
): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => updateVehicle(id, data, token))
}

export function updateVehicleStatusAction(
  id: string,
  status: VehicleStatus,
): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => updateVehicleStatus(id, status, token))
}

export function retireVehicleAction(id: string): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => retireVehicle(id, token))
}
