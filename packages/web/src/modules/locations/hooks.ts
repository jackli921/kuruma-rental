import type { ActionResult } from '@/modules/locations/actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const locationKeys = {
  all: ['locations'] as const,
  list: () => [...locationKeys.all, 'list'] as const,
  // #435: the vehicle picker needs an ACTIVE, cross-operator list. The Locations
  // page reuses `list()` with includeArchived=true, so a shared key would let
  // archived rows bleed into the picker (and vice-versa) within the staleTime
  // window. Keep the assignable list on its own key.
  assignable: () => [...locationKeys.all, 'assignable'] as const,
} as const

interface UseLocationMutationOptions<TInput, TData> {
  mutationFn: (input: TInput) => Promise<ActionResult<TData>>
  onSuccess?: (data: TData) => void
}

export function useLocationMutation<TInput, TData = unknown>({
  mutationFn,
  onSuccess,
}: UseLocationMutationOptions<TInput, TData>) {
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TInput>({
    mutationFn: async (input) => {
      const result = await mutationFn(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: locationKeys.all })
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
