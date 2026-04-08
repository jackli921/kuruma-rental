import { getErrorMessage, isNotFoundError } from '@/lib/error-helpers'
import { describe, expect, test } from 'vitest'

describe('getErrorMessage', () => {
  test('extracts message from Error instance', () => {
    expect(getErrorMessage(new Error('Something failed'))).toBe('Something failed')
  })

  test('returns string errors as-is', () => {
    expect(getErrorMessage('connection timeout')).toBe('connection timeout')
  })

  test('returns fallback for null', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred')
  })

  test('returns fallback for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred')
  })

  test('returns fallback for non-error objects', () => {
    expect(getErrorMessage({ code: 500 })).toBe('An unexpected error occurred')
  })

  test('accepts custom fallback message', () => {
    expect(getErrorMessage(null, 'Custom fallback')).toBe('Custom fallback')
  })
})

describe('isNotFoundError', () => {
  test('returns true for NEXT_NOT_FOUND digest', () => {
    const error = Object.assign(new Error('not found'), {
      digest: 'NEXT_NOT_FOUND',
    })
    expect(isNotFoundError(error)).toBe(true)
  })

  test('returns false for regular errors', () => {
    expect(isNotFoundError(new Error('server error'))).toBe(false)
  })

  test('returns false for non-error values', () => {
    expect(isNotFoundError(null)).toBe(false)
    expect(isNotFoundError('string')).toBe(false)
  })
})
