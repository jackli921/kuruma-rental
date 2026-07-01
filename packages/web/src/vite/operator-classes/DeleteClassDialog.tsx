import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type OperatorClass, archiveOperatorClass } from '@/vite/operator-classes/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface DeleteClassDialogProps {
  readonly vehicleClass: OperatorClass | null
  readonly onOpenChange: (open: boolean) => void
}

// #528 slice 6. Archive (soft delete) a class. Unlike the frozen Next dialog, the
// Vite portal does NOT pre-block on fleet stats (the fleet-overview isn't ported,
// #526) — the active-bookings guard is authoritative server-side, which returns
// 409 "Cannot archive a class with active bookings". We surface that message
// inline and keep the dialog open so the owner can finish those bookings first.
export function DeleteClassDialog({ vehicleClass, onOpenChange }: DeleteClassDialogProps) {
  const t = useTranslations('business.classes')
  const queryClient = useQueryClient()
  // Cookie writes need the double-submit CSRF token echoed in the header (#1304).
  const csrfToken = useSession().data?.csrfToken ?? ''

  const { mutate, isPending, error } = useMutation({
    mutationFn: (id: string) => archiveOperatorClass(id, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operator-classes'] })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard: isPending updates between renders, so two clicks
  // in the same frame both see isPending===false and fire archive twice. A ref
  // flips synchronously in onClick.
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) inFlightRef.current = false

  const isOpen = vehicleClass !== null

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle', { name: vehicleClass?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
        </DialogHeader>

        {error && <p className="px-1 text-sm text-destructive">{error.message}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || vehicleClass == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !vehicleClass) return
              inFlightRef.current = true
              mutate(vehicleClass.id)
            }}
          >
            {isPending ? t('deleting') : t('deleteConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
