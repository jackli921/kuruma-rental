const DEFAULT_MESSAGE = 'An unexpected error occurred'

export function getErrorMessage(error: unknown, fallback: string = DEFAULT_MESSAGE): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return fallback
}

export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'digest' in error &&
    (error as { digest?: string }).digest === 'NEXT_NOT_FOUND'
  )
}
