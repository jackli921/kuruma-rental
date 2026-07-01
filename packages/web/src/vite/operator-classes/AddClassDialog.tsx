import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ClassForm } from '@/vite/operator-classes/ClassForm'
import { createOperatorClass } from '@/vite/operator-classes/api'
import type { CreateVehicleClassInput } from '@kuruma/shared/validators/vehicle-class'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddClassDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly pickedOperatorId?: string | undefined
}

// #528 slice 4. Create a class via the slice-2 client. On success, invalidate the
// operator-classes list so the new row appears, then close. A slug collision
// (server 409 "Slug already in use") surfaces inline and keeps the dialog open
// so the owner can fix it — there is no client-side uniqueness pre-check.
export function AddClassDialog({ open, onOpenChange, pickedOperatorId }: AddClassDialogProps) {
  const t = useTranslations('business.classes')
  const queryClient = useQueryClient()

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateVehicleClassInput) =>
      createOperatorClass(pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operator-classes'] })
      onOpenChange(false)
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addClass')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="px-1 text-sm text-destructive">{error.message}</p>}
        <ClassForm
          onSubmit={async (data) => {
            // mutateAsync rejects on error; useMutation already captured it in
            // `error`, so swallow here to avoid an unhandled rejection.
            await mutateAsync(data).catch(() => {})
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
