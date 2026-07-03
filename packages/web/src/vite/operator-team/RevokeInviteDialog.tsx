import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TEAM_INVITES_QUERY_KEY, revokeInvite } from '@/vite/operator-team/api'
import type { OperatorInviteData } from '@kuruma/shared/types/operator-team'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface RevokeInviteDialogProps {
  invite: OperatorInviteData | null
  onOpenChange: (open: boolean) => void
  csrfToken: string
  // Picked tenant (picker-admin) or the operator's own id — ignored server-side
  // for a self-scoped operator.
  operatorId: string
}

// #904 slice 2: owner-only revoke of a pending staff invite. The API returns 404
// for an unknown/foreign id (tenant is session-derived), surfaced inline via the
// thrown ApiError message. Success invalidates the invites query and closes;
// closing resets the mutation so a prior refusal never lingers on reopen.
export function RevokeInviteDialog({
  invite,
  onOpenChange,
  csrfToken,
  operatorId,
}: RevokeInviteDialogProps) {
  const t = useTranslations('business.team')
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => revokeInvite(id, csrfToken, operatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_INVITES_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so two
  // clicks in one frame would both see false and fire revoke twice. A ref flips
  // synchronously in onClick (mirrors ArchiveLocationDialog).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) inFlightRef.current = false

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) mutation.reset()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={invite !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('revokeTitle', { email: invite?.email ?? '' })}</DialogTitle>
          <DialogDescription>{t('revokeDescription')}</DialogDescription>
        </DialogHeader>

        {mutation.error && (
          <p className="px-1 text-sm text-destructive">{mutation.error.message}</p>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('form.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || invite == null}
            onClick={() => {
              if (inFlightRef.current || mutation.isPending || !invite) return
              inFlightRef.current = true
              mutation.mutate(invite.id)
            }}
          >
            {mutation.isPending ? t('revoking') : t('revokeConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
