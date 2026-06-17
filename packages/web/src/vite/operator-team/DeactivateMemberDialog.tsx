import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TEAM_MEMBERS_QUERY_KEY, deactivateMember } from '@/vite/operator-team/api'
import type { OperatorMemberData } from '@kuruma/shared/types/operator-team'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'

interface DeactivateMemberDialogProps {
  member: OperatorMemberData | null
  onOpenChange: (open: boolean) => void
  csrfToken: string
}

// #904 slice 2: owner-only deactivation of a staff member. The API refuses the
// last owner with 409 (and 404 for an unknown/foreign id, tenant being
// session-derived); either message surfaces inline via the thrown ApiError.
// Success invalidates the members query and closes; closing resets the mutation.
export function DeactivateMemberDialog({
  member,
  onOpenChange,
  csrfToken,
}: DeactivateMemberDialogProps) {
  const t = useTranslations('business.team')
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (id: string) => deactivateMember(id, csrfToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_MEMBERS_QUERY_KEY })
      onOpenChange(false)
    },
  })

  // Synchronous in-flight guard: isPending only flips between renders, so two
  // clicks in one frame would both see false and fire deactivate twice. A ref
  // flips synchronously in onClick (mirrors ArchiveLocationDialog).
  const inFlightRef = useRef(false)
  if (!mutation.isPending && inFlightRef.current) inFlightRef.current = false

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) mutation.reset()
    onOpenChange(nextOpen)
  }

  const name = member?.name ?? t('unknownName')

  return (
    <Dialog open={member !== null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deactivateTitle', { name })}</DialogTitle>
          <DialogDescription>{t('deactivateDescription')}</DialogDescription>
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
            disabled={mutation.isPending || member == null}
            onClick={() => {
              if (inFlightRef.current || mutation.isPending || !member) return
              inFlightRef.current = true
              mutation.mutate(member.id)
            }}
          >
            {mutation.isPending ? t('deactivating') : t('deactivateConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
