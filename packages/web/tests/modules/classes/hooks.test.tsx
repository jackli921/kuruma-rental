import type { ActionResult } from '@/modules/classes/actions'
import { useClassMutation } from '@/modules/classes/hooks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

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

describe('useClassMutation', () => {
  it('invalidates the classes cache and calls onSuccess on success', async () => {
    const onSuccess = vi.fn()
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<{ id: string }>>>()
    mutationFn.mockResolvedValueOnce({ success: true, data: { id: 'c1' } })

    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useClassMutation({ mutationFn, onSuccess }), {
      wrapper: Wrapper,
    })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(onSuccess).toHaveBeenCalledWith({ id: 'c1' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['classes'] })
  })

  it('exposes errorCode when the ActionResult carries one (OPERATOR_REQUIRED)', async () => {
    // #407 P2 (§3e): mirror useVehicleMutation so AddClassDialog can recover.
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockResolvedValueOnce({
      success: false,
      error: 'operatorId is required',
      code: 'OPERATOR_REQUIRED',
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useClassMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.errorCode).toBe('OPERATOR_REQUIRED')
    expect(result.current.error).toBe('operatorId is required')
  })

  it('leaves errorCode undefined for a code-less failure', async () => {
    const mutationFn = vi.fn<(input: string) => Promise<ActionResult<unknown>>>()
    mutationFn.mockResolvedValueOnce({ success: false, error: 'Class not found' })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useClassMutation({ mutationFn }), { wrapper: Wrapper })

    result.current.mutate('input')
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.errorCode).toBeUndefined()
    expect(result.current.error).toBe('Class not found')
  })
})
