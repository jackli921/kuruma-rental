import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  LOCATIONS_QUERY_KEY,
  LocationArchiveBlockedError,
  type OperatorLocation,
  archiveLocation,
} from '@/vite/operator-locations/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface ArchiveLocationDialogProps {
  location: OperatorLocation | null
  onOpenChange: (open: boolean) => void
}

// #529 slice 4: soft-archive a location. The API refuses (#412) when live
// bookings still point at it, returning a count this dialog renders localized so
// the owner knows how many to reassign/cancel first; any other failure shows its
// raw message. Closing resets the mutation so a prior refusal never lingers.
export function ArchiveLocationDialog({ location, onOpenChange }: ArchiveLocationDialogProps) {
  const t = useTranslations('business.locations')
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: archiveLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so two
  // clicks in one frame would both see false and fire archive twice. A ref flips
  // synchronously in onClick (mirrors the frozen ArchiveLocationDialog).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) inFlightRef.current = false

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) mutation.reset()
    onOpenChange(nextOpen)
  }

  const { error } = mutation
  const errorMessage =
    error instanceof LocationArchiveBlockedError
      ? t('archiveBlocked', { count: error.activeBookingsCount })
      : error?.message

  return (
    <Dialog open={location !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { name: location?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {errorMessage && <p className="text-sm text-destructive px-1">{errorMessage}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || location == null}
            onClick={() => {
              if (inFlightRef.current || mutation.isPending || !location) return
              inFlightRef.current = true
              mutation.mutate(location.id)
            }}
          >
            {mutation.isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
