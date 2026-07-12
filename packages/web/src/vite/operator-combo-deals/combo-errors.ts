import { ApiError } from '@/lib/api-error'

// Maps an API failure to operator-legible copy by its envelope `code`/`status`
// rather than regexing the message (#934). A duplicate (operator, class, location)
// scope 409s; an archived/cross-operator class or location 400s with a specific
// code so the operator knows which field to fix. Shared by the add/edit dialogs
// AND the list's direct activate/deactivate toggle (which can 400 on an activate
// that fails the Q-B publishability rule).
export function comboErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_VEHICLE_CLASS') return t('error.invalidClass')
    if (error.code === 'INVALID_LOCATION') return t('error.invalidLocation')
    if (error.status === 409) return t('error.duplicate')
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
