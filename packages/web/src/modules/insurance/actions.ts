'use server'

import { getApiToken } from '@/lib/api-token'
import {
  type InsuranceOptionData,
  archiveInsuranceOption,
  createInsuranceOption,
  fetchInsuranceOptions,
  updateInsuranceOption,
} from '@/modules/insurance/api'
import type {
  CreateInsuranceOptionInput,
  UpdateInsuranceOptionInput,
} from '@kuruma/shared/validators/insurance-option'

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

export async function fetchInsuranceOptionsAction(options?: {
  includeArchived?: boolean
}): Promise<ActionResult<InsuranceOptionData[]>> {
  return withAuth((token) => fetchInsuranceOptions(options ?? {}, token))
}

export async function createInsuranceOptionAction(
  data: CreateInsuranceOptionInput,
): Promise<ActionResult<InsuranceOptionData>> {
  return withAuth((token) => createInsuranceOption(data, token))
}

export async function updateInsuranceOptionAction(
  id: string,
  data: UpdateInsuranceOptionInput,
): Promise<ActionResult<InsuranceOptionData>> {
  return withAuth((token) => updateInsuranceOption(id, data, token))
}

export async function archiveInsuranceOptionAction(
  id: string,
): Promise<ActionResult<InsuranceOptionData>> {
  return withAuth((token) => archiveInsuranceOption(id, token))
}
