import type { ActionResult } from '@/modules/insurance/actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const insuranceKeys = {
  all: ['insurance-options'] as const,
  list: () => [...insuranceKeys.all, 'list'] as const,
} as const

interface UseInsuranceMutationOptions<TInput, TData> {
  mutationFn: (input: TInput) => Promise<ActionResult<TData>>
  onSuccess?: (data: TData) => void
}

export function useInsuranceMutation<TInput, TData = unknown>({
  mutationFn,
  onSuccess,
}: UseInsuranceMutationOptions<TInput, TData>) {
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TInput>({
    mutationFn: async (input) => {
      const result = await mutationFn(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: insuranceKeys.all })
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
