'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type FeeScheduleData,
  archiveFeeSchedule,
  createFeeSchedule,
  fetchFeeSchedules,
  updateFeeSchedule,
} from '@/modules/fees/api'
import type {
  CreateFeeScheduleInput,
  UpdateFeeScheduleInput,
} from '@kuruma/shared/validators/fee-schedule'

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

export async function fetchFeeSchedulesAction(options?: {
  includeArchived?: boolean
}): Promise<ActionResult<FeeScheduleData[]>> {
  return withAuth((token) => fetchFeeSchedules(options ?? {}, token))
}

export async function createFeeScheduleAction(
  data: CreateFeeScheduleInput,
): Promise<ActionResult<FeeScheduleData>> {
  return withAuth((token) => createFeeSchedule(data, token))
}

export async function updateFeeScheduleAction(
  id: string,
  data: UpdateFeeScheduleInput,
): Promise<ActionResult<FeeScheduleData>> {
  return withAuth((token) => updateFeeSchedule(id, data, token))
}

export async function archiveFeeScheduleAction(id: string): Promise<ActionResult<FeeScheduleData>> {
  return withAuth((token) => archiveFeeSchedule(id, token))
}
