'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OPERATOR_REQUIRED } from '@/lib/api-error'
import { createClassAction } from '@/modules/classes/actions'
import { ClassForm } from '@/modules/classes/components/ClassForm'
import { useClassMutation } from '@/modules/classes/hooks'
import { type OperatorOption, operatorKeys } from '@/modules/operators'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

interface AddClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operators?: readonly OperatorOption[] | undefined
}

export function AddClassDialog({ open, onOpenChange, operators }: AddClassDialogProps) {
  const t = useTranslations('business.classes')
  const queryClient = useQueryClient()
  const { mutate, isPending, error, errorCode, reset } = useClassMutation({
    mutationFn: createClassAction,
    onSuccess: () => onOpenChange(false),
  })

  // #407 P2 (§3e): a 422 means a second operator now exists and the cached
  // single-operator list is stale. Refetch operators and force the picker open.
  const operatorRequired = errorCode === OPERATOR_REQUIRED
  useEffect(() => {
    if (operatorRequired) queryClient.invalidateQueries({ queryKey: operatorKeys.all })
  }, [operatorRequired, queryClient])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addClass')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {/* OPERATOR_REQUIRED is surfaced inline by the picker, not here. */}
        {error && !operatorRequired && <p className="text-sm text-destructive px-1">{error}</p>}
        <ClassForm
          onSubmit={async (data) => mutate(data)}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
          operators={operators}
          operatorRequired={operatorRequired}
        />
      </DialogContent>
    </Dialog>
  )
}
