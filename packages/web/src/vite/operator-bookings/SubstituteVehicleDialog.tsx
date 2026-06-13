import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { substituteVehicle, substitutionCandidatesQueryOptions } from '@/vite/operator-bookings/api'
import { useSession } from '@/vite/session'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'

// #616: swap the assigned car for another eligible vehicle. Eligibility (same
// store + same ACRISS class + AVAILABLE, excluding the current car) is decided
// server-side by GET /substitution-candidates — never re-derived here — so the
// rule lives in exactly one place (the list endpoint can't even feed it: it
// carries classId, not the acrissCode the real rule uses).
const OPERATOR_BOOKINGS_KEY = ['operator-bookings'] as const

interface SubstituteVehicleDialogProps {
  readonly bookingId: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function SubstituteVehicleDialog({
  bookingId,
  open,
  onOpenChange,
}: SubstituteVehicleDialogProps) {
  const t = useTranslations('bookings.operator.detail.actions')
  const queryClient = useQueryClient()
  const router = useRouter()
  const csrfToken = useSession().data?.csrfToken ?? ''

  // Only fetch while the dialog is open — the panel mounts it permanently.
  const { data: candidates, isLoading } = useQuery({
    ...substitutionCandidatesQueryOptions(bookingId),
    enabled: open,
  })

  const [vehicleId, setVehicleId] = useState('')
  const [reason, setReason] = useState('')

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => substituteVehicle(bookingId, vehicleId, reason.trim() || null, csrfToken),
    onSuccess: async () => {
      // Prefix-invalidate (list + calendar + badge) then re-run the loader so
      // the detail + timeline reflect the new car and the VEHICLE_SUBSTITUTED event.
      await queryClient.invalidateQueries({ queryKey: OPERATOR_BOOKINGS_KEY })
      await router.invalidate()
      onOpenChange(false)
    },
  })

  // Synchronous double-submit guard: isPending only flips between renders, so two
  // clicks in one frame both read false; a ref flips immediately in onClick.
  const inFlightRef = useRef(false)
  if (!isPending && inFlightRef.current) inFlightRef.current = false

  const options = candidates ?? []
  const hasCandidates = options.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('substituteTitle')}</DialogTitle>
          <DialogDescription>{t('substituteDescription')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('substituteLoading')}</p>
        ) : hasCandidates ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="substitute-vehicle">{t('substituteVehicleLabel')}</Label>
              <select
                id="substitute-vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="" disabled>
                  —
                </option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="substitute-reason">{t('substituteReason')}</Label>
              <Textarea
                id="substitute-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('substituteEmpty')}</p>
        )}

        {error && (
          <p className="px-1 text-sm text-destructive">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('back')}
          </Button>
          <Button
            disabled={!vehicleId || isPending || !hasCandidates}
            onClick={() => {
              if (inFlightRef.current || isPending || !vehicleId) return
              inFlightRef.current = true
              mutate()
            }}
          >
            {isPending ? t('working') : t('substituteSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
