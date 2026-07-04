import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type FeeClassOption, FeeScheduleForm } from '@/vite/operator-fees/FeeScheduleForm'
import {
  type CreateFeeScheduleInput,
  FEE_QUERY_KEY,
  createFeeSchedule,
} from '@/vite/operator-fees/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddFeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: readonly FeeClassOption[]
  /** #1442: a picker admin stamps the chosen operatorId into the create body; an
   *  operator session omits it (the server auto-scopes the tenant). */
  pickedOperatorId?: string | undefined
}

export function AddFeeDialog({ open, onOpenChange, classes, pickedOperatorId }: AddFeeDialogProps) {
  const t = useTranslations('business.fees')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateFeeScheduleInput) =>
      createFeeSchedule(
        pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data,
        csrfToken,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FEE_QUERY_KEY })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addFee')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <FeeScheduleForm
          classes={classes}
          onSubmit={async (data) => {
            await mutateAsync(data)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
