import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ApiError } from '@/lib/api-error'
import {
  type ComboClassOption,
  ComboForm,
  type ComboLocationOption,
} from '@/vite/operator-combo-deals/ComboForm'
import {
  COMBO_QUERY_KEY,
  type CreateClassRatePlanInput,
  createComboDeal,
} from '@/vite/operator-combo-deals/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'

interface AddComboDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: readonly ComboClassOption[]
  locations: readonly ComboLocationOption[]
  /** A picker admin stamps the chosen operatorId into the create body; an
   *  operator session omits it (the server auto-scopes the tenant). */
  pickedOperatorId?: string | undefined
}

export function AddComboDialog({
  open,
  onOpenChange,
  classes,
  locations,
  pickedOperatorId,
}: AddComboDialogProps) {
  const t = useTranslations('business.comboDeals')
  const queryClient = useQueryClient()
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutateAsync, isPending, error, reset } = useMutation({
    mutationFn: (data: CreateClassRatePlanInput) =>
      createComboDeal(
        pickedOperatorId ? { ...data, operatorId: pickedOperatorId } : data,
        csrfToken,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
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
          <DialogTitle>{t('addDeal')}</DialogTitle>
          <DialogDescription>{t('addSubtitle')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive px-1">{comboErrorMessage(error, t)}</p>}
        <ComboForm
          classes={classes}
          locations={locations}
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

// Maps the API failure to operator-legible copy by its envelope `code`/`status`
// rather than regexing the message (#934). A duplicate (operator, class, location)
// scope 409s; an archived/cross-operator class or location 400s with a specific
// code so the operator knows which field to fix.
export function comboErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_VEHICLE_CLASS') return t('error.invalidClass')
    if (error.code === 'INVALID_LOCATION') return t('error.invalidLocation')
    if (error.status === 409) return t('error.duplicate')
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}
