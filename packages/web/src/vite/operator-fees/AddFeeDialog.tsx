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
}

export function AddFeeDialog({ open, onOpenChange, classes }: AddFeeDialogProps) {
  const t = useTranslations('business.fees')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateFeeScheduleInput) => createFeeSchedule(data, csrfToken),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
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
