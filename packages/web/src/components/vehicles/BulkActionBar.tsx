'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { bulkUpdateVehicleStatus } from '@/lib/vehicle-api'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type BulkStatus = 'AVAILABLE' | 'MAINTENANCE'

interface BulkActionBarProps {
  selectedIds: ReadonlySet<string>
  onClearSelection: () => void
}

export function BulkActionBar({ selectedIds, onClearSelection }: BulkActionBarProps) {
  const t = useTranslations('business.vehicles')
  const queryClient = useQueryClient()
  const [confirmAction, setConfirmAction] = useState<BulkStatus | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = selectedIds.size
  if (count === 0) return null

  const handleConfirm = async () => {
    if (!confirmAction) return
    setIsSubmitting(true)
    setError(null)
    try {
      await bulkUpdateVehicleStatus([...selectedIds], confirmAction)
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onClearSelection()
      setConfirmAction(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm p-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('bulk.selectedCount', { count })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClearSelection}>
              {t('bulk.deselectAll')}
            </Button>
            <Button size="sm" onClick={() => setConfirmAction('AVAILABLE')}>
              {t('bulk.setAvailable')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmAction('MAINTENANCE')}>
              {t('bulk.setMaintenance')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={confirmAction !== null} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bulk.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('bulk.confirmMessage', {
                count,
                status:
                  confirmAction === 'AVAILABLE' ? t('status.AVAILABLE') : t('status.MAINTENANCE'),
              })}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive px-1">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              {t('form.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? '...' : t('form.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
