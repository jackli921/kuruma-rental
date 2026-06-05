import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/query-keys', () => ({
  vehicleKeys: {
    all: ['vehicles'] as const,
    fleetOverview: ['vehicles', 'fleet-overview'] as const,
  },
}))

import type { ActionResult } from '@/lib/vehicle-actions'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { Wrapper, queryClient }
}

// Lazy import so the mock is in place
async function loadHook() {
  const { useVehicleMutation } = await import('@/hooks/useVehicleMutation')
  return useVehicleMutation
}

describe('useVehicleMutation', () => {
  it('calls onSuccess and invalidates cache on ActionResult success', async () => {
    const useVehicleMutation = await loadHook()
    const onSuccess = vi.fn()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<{ id: string }>>>()
    mutationFn.mockResolvedValueOnce({ success: true, data: { id: 'v1' } })

    const { Wrapper, queryClient } = createWrapper()
    // Seed cache so we can verify invalidation
    queryClient.setQueryData(['vehicles', 'fleet-overview'], [{ id: 'v1' }])
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useVehicleMutation({ mutationFn, onSuccess }), {
      wrapper: Wrapper,
    })

    result.current.mutate('test-input')

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    expect(mutationFn).toHaveBeenCalledWith('test-input')
    expect(onSuccess).toHaveBeenCalledWith({ id: 'v1' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] })
    expect(result.current.error).toBeNull()
  })

  it('exposes error string when ActionResult returns success:false', async () => {
    const useVehicleMutation = await loadHook()
    const onSuccess = vi.fn()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockResolvedValueOnce({ success: false, error: 'Vehicle not found' })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVehicleMutation({ mutationFn, onSuccess }), {
      wrapper: Wrapper,
    })

    result.current.mutate('bad-input')

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    expect(result.current.error).toBe('Vehicle not found')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('exposes errorCode when the ActionResult carries one (OPERATOR_REQUIRED)', async () => {
    // #407 P2 (§3e): the hook must surface result.code so the dialog can reveal
    // the operator picker instead of showing a generic error toast.
    const useVehicleMutation = await loadHook()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockResolvedValueOnce({
      success: false,
      error: 'operatorId is required',
      code: 'OPERATOR_REQUIRED',
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVehicleMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.errorCode).toBe('OPERATOR_REQUIRED')
    expect(result.current.error).toBe('operatorId is required')
  })

  it('leaves errorCode undefined for a code-less failure', async () => {
    const useVehicleMutation = await loadHook()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockResolvedValueOnce({ success: false, error: 'Vehicle not found' })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVehicleMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.errorCode).toBeUndefined()
  })

  it('exposes error string when mutationFn throws an exception', async () => {
    const useVehicleMutation = await loadHook()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockRejectedValueOnce(new Error('Network failure'))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVehicleMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')

    await waitFor(() => {
      expect(result.current.isPending).toBe(false)
    })

    expect(result.current.error).toBe('Network failure')
  })

  it('clears error when a subsequent mutate succeeds', async () => {
    const useVehicleMutation = await loadHook()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<{ id: string }>>>()
    mutationFn.mockResolvedValueOnce({ success: false, error: 'First attempt failed' })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVehicleMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.error).toBe('First attempt failed'))

    mutationFn.mockResolvedValueOnce({ success: true, data: { id: 'v1' } })
    result.current.mutate('input')
    await waitFor(() => expect(result.current.error).toBeNull())
  })
})
