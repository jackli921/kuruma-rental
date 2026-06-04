import type { ActionResult } from '@/modules/fees/actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const feeKeys = {
  all: ['fee-schedules'] as const,
  list: () => [...feeKeys.all, 'list'] as const,
} as const

interface UseFeeMutationOptions<TInput, TData> {
  mutationFn: (input: TInput) => Promise<ActionResult<TData>>
  onSuccess?: (data: TData) => void
}

export function useFeeMutation<TInput, TData = unknown>({
  mutationFn,
  onSuccess,
}: UseFeeMutationOptions<TInput, TData>) {
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TInput>({
    mutationFn: async (input) => {
      const result = await mutationFn(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: feeKeys.all })
      onSuccess?.(data)
    },
  })

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
    reset: mutation.reset,
  }
}
