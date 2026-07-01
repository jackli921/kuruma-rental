import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  FLEET_QUERY_KEY,
  type OperatorFleetVehicle,
  retireVehicle,
  updateVehicleStatus,
} from '@/vite/operator-fleet/api'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface FleetRowActionsProps {
  readonly vehicle: OperatorFleetVehicle
  readonly onEdit: () => void
}

type OpenDialog = 'none' | 'maintenance' | 'retire'

// Controlled per-row actions for the operator fleet list (#556): edit, toggle
// AVAILABLE <-> MAINTENANCE (the latter behind a reason prompt), and retire
// behind a confirm. No routing / global state — the parent owns the Edit drawer
// via onEdit; every write goes through the injected api functions and
// invalidates the shared fleet query on success so the list re-fetches.
export function FleetRowActions({ vehicle, onEdit }: FleetRowActionsProps) {
  const t = useTranslations('business.vehicles')
  const tFleet = useTranslations('business.vehicles.fleet')
  const queryClient = useQueryClient()
  // Cookie writes need the double-submit CSRF token echoed in the header (#1304).
  const csrfToken = useSession().data?.csrfToken ?? ''
  const [openDialog, setOpenDialog] = useState<OpenDialog>('none')
  const [reason, setReason] = useState('')

  const invalidateFleet = () => queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY })

  const statusMutation = useMutation({
    mutationFn: ({ status, reason }: { status: 'AVAILABLE' | 'MAINTENANCE'; reason?: string }) =>
      status === 'MAINTENANCE'
        ? updateVehicleStatus(vehicle.id, status, csrfToken, reason)
        : updateVehicleStatus(vehicle.id, status, csrfToken),
    onSuccess: () => {
      setOpenDialog('none')
      setReason('')
      invalidateFleet()
    },
  })

  const retireMutation = useMutation({
    mutationFn: () => retireVehicle(vehicle.id, csrfToken),
    onSuccess: () => {
      setOpenDialog('none')
      invalidateFleet()
    },
  })

  const isMaintenance = vehicle.status === 'MAINTENANCE'
  const trimmedReason = reason.trim()

  function handleToggleStatus() {
    if (isMaintenance) {
      statusMutation.mutate({ status: 'AVAILABLE' })
      return
    }
    setReason('')
    setOpenDialog('maintenance')
  }

  function handleMaintenanceSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trimmedReason) return
    statusMutation.mutate({ status: 'MAINTENANCE', reason: trimmedReason })
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={tFleet('columns.actions')}>
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>{t('editVehicle')}</DropdownMenuItem>
          <DropdownMenuItem onClick={handleToggleStatus}>
            {isMaintenance ? t('actions.setAvailable') : t('actions.setMaintenance')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setOpenDialog('retire')}>
            {t('retireVehicle')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The AVAILABLE toggle fires without a dialog, so its failure needs an
          inline slot. Errors raised while a dialog is open surface inside it. */}
      {statusMutation.isError && openDialog === 'none' && (
        <output className="text-[11px] text-destructive">{t('statusToggle.error')}</output>
      )}

      <Dialog
        open={openDialog === 'maintenance'}
        onOpenChange={(open) => {
          if (!open) {
            setOpenDialog('none')
            setReason('')
            statusMutation.reset()
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleMaintenanceSubmit}>
            <DialogHeader>
              <DialogTitle>{t('maintenance.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('maintenance.dialogDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="fleet-maintenance-reason">
                {t('maintenance.reasonLabel')} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="fleet-maintenance-reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('maintenance.reasonPlaceholder')}
              />
            </div>
            {statusMutation.isError && (
              <p className="px-1 text-sm text-destructive">{t('statusToggle.error')}</p>
            )}
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline" disabled={statusMutation.isPending} />
                }
              >
                {t('maintenance.cancel')}
              </DialogClose>
              <Button type="submit" disabled={statusMutation.isPending || !trimmedReason}>
                {t('maintenance.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openDialog === 'retire'}
        onOpenChange={(open) => {
          if (!open) {
            setOpenDialog('none')
            retireMutation.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('retireConfirm', { name: vehicle.name })}</DialogTitle>
            <DialogDescription>{t('retireConfirmMessage')}</DialogDescription>
          </DialogHeader>
          {retireMutation.isError && (
            <p className="px-1 text-sm text-destructive">{t('retireError')}</p>
          )}
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={retireMutation.isPending} />
              }
            >
              {t('form.cancel')}
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => retireMutation.mutate()}
              disabled={retireMutation.isPending}
            >
              {t('retireVehicle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
