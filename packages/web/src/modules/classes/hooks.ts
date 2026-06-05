import { ActionError } from '@/lib/api-error'
import type { ActionResult } from '@/modules/classes/actions'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export const classKeys = {
  all: ['classes'] as const,
  list: () => [...classKeys.all, 'list'] as const,
} as const

interface UseClassMutationOptions<TInput, TData> {
  mutationFn: (input: TInput) => Promise<ActionResult<TData>>
  onSuccess?: (data: TData) => void
}

export function useClassMutation<TInput, TData = unknown>({
  mutationFn,
  onSuccess,
}: UseClassMutationOptions<TInput, TData>) {
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TInput>({
    mutationFn: async (input) => {
      const result = await mutationFn(input)
      if (!result.success) throw new ActionError(result.error, result.code)
      return result.data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: classKeys.all })
      onSuccess?.(data)
    },
  })

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error?.message ?? null,
    errorCode: mutation.error instanceof ActionError ? mutation.error.code : undefined,
    reset: mutation.reset,
  }
}
