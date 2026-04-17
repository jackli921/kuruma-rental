import { vehicleKeys } from '@/lib/query-keys'
import type { ActionResult } from '@/lib/vehicle-actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'

interface UseVehicleMutationOptions<TInput, TData> {
  mutationFn: (input: TInput) => Promise<ActionResult<TData>>
  onSuccess?: (data: TData) => void
}

export function useVehicleMutation<TInput, TData = unknown>({
  mutationFn,
  onSuccess,
}: UseVehicleMutationOptions<TInput, TData>) {
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TInput>({
    mutationFn: async (input) => {
      const result = await mutationFn(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all })
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
