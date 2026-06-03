'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { archiveInsuranceOptionAction } from '@/modules/insurance/actions'
import type { InsuranceOptionData } from '@/modules/insurance/api'
import { useInsuranceMutation } from '@/modules/insurance/hooks'
import { useTranslations } from 'next-intl'
import { useRef } from 'react'

interface InsuranceArchiveDialogProps {
  option: InsuranceOptionData | null
  onOpenChange: (open: boolean) => void
}

export function InsuranceArchiveDialog({ option, onOpenChange }: InsuranceArchiveDialogProps) {
  const t = useTranslations('business.insurance')
  const { mutate, isPending, error } = useInsuranceMutation<string>({
    mutationFn: (id) => archiveInsuranceOptionAction(id),
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
    <Dialog open={option !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle', { name: option?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('archiveDescription')}</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive px-1">{error}</p>}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending || option == null}
            onClick={() => {
              if (inFlightRef.current || isPending || !option) return
              inFlightRef.current = true
              mutate(option.id)
            }}
          >
            {isPending ? t('archiving') : t('archiveConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
