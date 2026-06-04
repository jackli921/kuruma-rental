'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createClassAction } from '@/modules/classes/actions'
import { ClassForm } from '@/modules/classes/components/ClassForm'
import { useClassMutation } from '@/modules/classes/hooks'
import type { OperatorOption } from '@/modules/operators'
import { useTranslations } from 'next-intl'

interface AddClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operators?: readonly OperatorOption[] | undefined
}

export function AddClassDialog({ open, onOpenChange, operators }: AddClassDialogProps) {
  const t = useTranslations('business.classes')
  const { mutateAsync, isPending, error, reset } = useClassMutation({
    mutationFn: createClassAction,
    onSuccess: () => onOpenChange(false),
  })

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
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <ClassForm
          onSubmit={async (data) => {
            await mutateAsync(data)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
          operators={operators}
        />
      </DialogContent>
    </Dialog>
  )
}
