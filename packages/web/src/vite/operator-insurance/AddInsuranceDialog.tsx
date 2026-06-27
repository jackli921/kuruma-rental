import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { WithOperatorId } from '@/vite/operator-context'
import { InsuranceForm } from '@/vite/operator-insurance/InsuranceForm'
import {
  type CreateInsuranceOptionInput,
  INSURANCE_QUERY_KEY,
  createInsuranceOption,
} from '@/vite/operator-insurance/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddInsuranceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Set when a platform admin has picked a tenant. Merged into the create body so
  // the server's platform-admin create schema (which requires operatorId) is
  // satisfied; an operator session leaves this undefined and is auto-scoped.
  pickedOperatorId?: string | undefined
}

export function AddInsuranceDialog({
  open,
  onOpenChange,
  pickedOperatorId,
}: AddInsuranceDialogProps) {
  const t = useTranslations('business.insurance')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: WithOperatorId<CreateInsuranceOptionInput>) =>
      createInsuranceOption(data, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INSURANCE_QUERY_KEY })
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
          <DialogTitle>{t('addOption')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <InsuranceForm
          onSubmit={async (data) => {
            await mutateAsync(pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data)
          }}
          onCancel={() => handleOpenChange(false)}
          isSubmitting={isPending}
        />
      </DialogContent>
    </Dialog>
  )
}
