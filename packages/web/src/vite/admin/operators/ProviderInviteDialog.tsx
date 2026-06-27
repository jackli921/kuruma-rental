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
import { NativeSelect } from '@/components/ui/native-select'
import type { OperatorRole } from '@kuruma/shared/enums'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { type CreatedInvite, PROVIDER_INVITE_ROLES } from './api'

interface ProviderInviteDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly operatorName: string | null
  /** Set once the mint succeeds — flips the dialog to the one-time reveal view. */
  readonly created: CreatedInvite | null
  readonly isPending: boolean
  readonly error: string | null
  readonly onSubmit: (input: { email: string; role: OperatorRole }) => void
}

/**
 * Mint a provider invite for an operator (#1088). Pure presentational: the route
 * owns the `mintProviderInvite` mutation and passes `created`/`isPending`/`error`.
 * On success the form is replaced by the plaintext invite link — shown ONCE, with
 * copy-to-clipboard only (only its sha256 hash is persisted server-side). Local
 * form/copy state resets on close so a prior reveal never lingers on reopen.
 */
export function ProviderInviteDialog({
  open,
  onOpenChange,
  operatorName,
  created,
  isPending,
  error,
  onSubmit,
}: ProviderInviteDialogProps) {
  const t = useTranslations('admin.operators.inviteDialog')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<OperatorRole>(PROVIDER_INVITE_ROLES[0])
  const [copied, setCopied] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setEmail('')
      setRole(PROVIDER_INVITE_ROLES[0])
      setCopied(false)
    }
    onOpenChange(next)
  }

  const handleCopy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.inviteUrl)
      setCopied(true)
    } catch {
      // Clipboard can reject on an insecure context or denied permission; the URL
      // stays visible in the readonly input as the fallback.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? t('successTitle') : t('title')}</DialogTitle>
          <DialogDescription>
            {created ? t('successSubtitle') : t('subtitle', { operator: operatorName ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider-invite-url">{t('urlLabel')}</Label>
              <Input
                id="provider-invite-url"
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
              onSubmit({ email: email.trim(), role })
            }}
            className="space-y-4"
          >
            {error && <p className="px-1 text-destructive text-sm">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="provider-invite-email">{t('emailLabel')}</Label>
              <Input
                id="provider-invite-email"
                type="email"
                required
                autoComplete="off"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider-invite-role">{t('roleLabel')}</Label>
              <NativeSelect
                id="provider-invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as OperatorRole)}
              >
                {PROVIDER_INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isPending || email.trim().length === 0}>
                {isPending ? t('submitting') : t('submit')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
