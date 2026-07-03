import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TEAM_INVITES_QUERY_KEY, inviteStaff } from '@/vite/operator-team/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'

interface InviteStaffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  csrfToken: string
  operatorId: string
}

// #904: owner-only staff invite. On success the dialog does NOT close — it
// reveals the one-time invite URL (the token is never persisted in cleartext and
// no email is sent yet), so the owner copies it to share. The new pending row is
// pulled in by invalidating the invites query. Closing resets both the mutation
// and the local form/copy state so a prior reveal never lingers on reopen.
export function InviteStaffDialog({
  open,
  onOpenChange,
  csrfToken,
  operatorId,
}: InviteStaffDialogProps) {
  const t = useTranslations('business.team')
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)

  const mutation = useMutation({
    mutationFn: (value: string) => inviteStaff({ email: value }, csrfToken, operatorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEAM_INVITES_QUERY_KEY })
    },
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      mutation.reset()
      setEmail('')
      setCopied(false)
    }
    onOpenChange(nextOpen)
  }

  const created = mutation.data

  const handleCopy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.inviteUrl)
      setCopied(true)
    } catch {
      // Clipboard can reject on an insecure context or denied permission. The URL
      // stays visible in the readonly input as the fallback, so swallow rather
      // than leave an unhandled rejection.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? t('inviteSuccessTitle') : t('inviteTitle')}</DialogTitle>
          <DialogDescription>
            {created ? t('inviteSuccessSubtitle') : t('inviteSubtitle')}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-url">{t('inviteUrlLabel')}</Label>
              <Input
                id="invite-url"
                readOnly
                value={created.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCopy}>
                {copied ? t('copied') : t('copy')}
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t('done')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              mutation.mutate(email.trim())
            }}
            className="space-y-4"
          >
            {mutation.error && (
              <p className="px-1 text-sm text-destructive">{mutation.error.message}</p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t('form.email')}</Label>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="off"
                placeholder={t('form.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t('form.cancel')}
              </Button>
              <Button type="submit" disabled={mutation.isPending || email.trim().length === 0}>
                {mutation.isPending ? t('form.submitting') : t('form.submit')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
