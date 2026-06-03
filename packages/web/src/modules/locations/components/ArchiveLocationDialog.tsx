'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { archiveLocationAction } from '@/modules/locations/actions'
import type { LocationData } from '@/modules/locations/api'
import { useLocationMutation } from '@/modules/locations/hooks'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

interface ArchiveLocationDialogProps {
  location: LocationData | null
  onOpenChange: (open: boolean) => void
}

// No active-booking guard here: locations aren't attached to vehicles/bookings
// until slice 6, so archiving is always safe in slice 2 (mirrors the service's
// LocationService.archive comment).
export function ArchiveLocationDialog({ location, onOpenChange }: ArchiveLocationDialogProps) {
  const t = useTranslations('business.locations')
  const { mutate, isPending, error } = useLocationMutation<string>({
    mutationFn: (id) => archiveLocationAction(id),
    onSuccess: () => onOpenChange(false),
  })

  // Synchronous in-flight guard: isPending updates between renders, so two
  // clicks in the same frame both see false and fire archive twice. A ref
  // flips synchronously in onClick (mirrors DeleteClassDialog HIGH 1).
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  return (
    <Dialog open={location !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { name: location?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || location == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !location) return
              inFlightRef.current = true
              mutate(location.id)
            }}
          >
            {isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
