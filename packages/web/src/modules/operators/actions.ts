'use server'

import { getApiToken } from '@/lib/api-token'
import { type OperatorOption, fetchOperators } from '@/modules/operators/api'

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

export async function fetchOperatorsAction(): Promise<ActionResult<OperatorOption[]>> {
  const token = await getApiToken()
  if (!token) {
    return { success: false, error: 'Authentication required' }
  }
  try {
    return { success: true, data: await fetchOperators(token) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'An error occurred' }
  }
}
