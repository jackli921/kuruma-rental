'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { archiveFeeScheduleAction } from '@/modules/fees/actions'
import type { FeeScheduleData } from '@/modules/fees/api'
import { useFeeMutation } from '@/modules/fees/hooks'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

interface ArchiveFeeDialogProps {
  fee: FeeScheduleData | null
  onOpenChange: (open: boolean) => void
}

export function ArchiveFeeDialog({ fee, onOpenChange }: ArchiveFeeDialogProps) {
  const t = useTranslations('business.fees')
  const { mutate, isPending, error } = useFeeMutation<string>({
    mutationFn: (id) => archiveFeeScheduleAction(id),
    onSuccess: () => onOpenChange(false),
  })

  // Synchronous in-flight guard: isPending updates between renders, so two
  // clicks in the same frame both see false and fire archive twice. A ref
  // flips synchronously in onClick (mirrors ArchiveLocationDialog).
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) {
    inFlightRef.current = false
  }

  return (
    <Dialog open={fee !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('archiveTitle', { name: fee ? t(`type.${fee.feeType}`) : '' })}
          </DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || fee == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !fee) return
              inFlightRef.current = true
              mutate(fee.id)
            }}
          >
            {isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
