'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type FleetVehicleOverviewData,
  type PhotoDeleteResult,
  type PhotoUploadResult,
  type VehicleData,
  createVehicle,
  deleteVehiclePhoto,
  fetchFleetOverview,
  retireVehicle,
  updateVehicle,
  updateVehicleStatus,
  uploadVehiclePhotos,
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

export async function fetchFleetOverviewAction(): Promise<
  ActionResult<FleetVehicleOverviewData[]>
> {
  return withAuth((token) => fetchFleetOverview(token))
}

export async function createVehicleAction(
  data: CreateVehicleInput,
): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => createVehicle(data, token))
}

export async function updateVehicleAction(
  id: string,
  data: Partial<CreateVehicleInput>,
): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => updateVehicle(id, data, token))
}

export async function updateVehicleStatusAction(
  id: string,
  status: VehicleStatus,
  reason?: string,
): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => updateVehicleStatus(id, status, reason, token))
}

export async function retireVehicleAction(id: string): Promise<ActionResult<VehicleData>> {
  return withAuth((token) => retireVehicle(id, token))
}

export async function uploadVehiclePhotosAction(
  vehicleId: string,
  formData: FormData,
): Promise<ActionResult<PhotoUploadResult>> {
  const files = formData.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return { success: false, error: 'No files provided' }
  }
  return withAuth((token) => uploadVehiclePhotos(vehicleId, files, token))
}

export async function deleteVehiclePhotoAction(
  vehicleId: string,
  photoIdx: number,
): Promise<ActionResult<PhotoDeleteResult>> {
  return withAuth((token) => deleteVehiclePhoto(vehicleId, photoIdx, token))
}
