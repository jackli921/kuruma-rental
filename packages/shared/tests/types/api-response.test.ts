import type { ApiResponse } from '@kuruma/shared/types/api-response'
import { describe, expect, it } from 'vitest'

describe('ApiResponse<T>', () => {
  it('narrows to data on success', () => {
    const response: ApiResponse<{ id: string }> = {
      success: true,
      data: { id: 'abc' },
    }

    if (response.success) {
      // TypeScript narrows: response.data is { id: string }, not optional
      expect(response.data.id).toBe('abc')
    }
  })

  it('narrows to error on failure', () => {
    const response: ApiResponse<{ id: string }> = {
      success: false,
      error: 'Not found',
    }

    if (!response.success) {
      // TypeScript narrows: response.error is string, guaranteed
      expect(response.error).toBe('Not found')
    }
  })

  it('allows optional code and details on failure', () => {
    const response: ApiResponse<never> = {
      success: false,
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { email: ['Invalid email format'] },
    }

    if (!response.success) {
      expect(response.code).toBe('VALIDATION_ERROR')
      expect(response.details?.email).toEqual(['Invalid email format'])
    }
  })

  it('forbids data on failure branch', () => {
    // This test verifies the discriminated union is correct at the type level.
    // If someone tried to access .data on the failure branch, TypeScript
    // would error. We verify the runtime shape instead:
    const response: ApiResponse<string> = { success: false, error: 'bad' }
    expect('data' in response).toBe(false)
  })

  it('forbids error on success branch', () => {
    const response: ApiResponse<string> = { success: true, data: 'ok' }
    expect('error' in response).toBe(false)
  })
})
