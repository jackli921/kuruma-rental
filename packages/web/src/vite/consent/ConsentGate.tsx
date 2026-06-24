import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { acceptConsent } from '@/vite/consent/api'
import { CONSENT_QUERY_KEY, usePendingConsents } from '@/vite/consent/hooks'
import type { PendingConsent } from '@/vite/consent/types'
import { useSession } from '@/vite/session'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'

const RENTER_ROLE = 'RENTER'

interface ConsentGateProps {
  readonly locale: string
  readonly children: ReactNode
}

/**
 * Flow A clickwrap gate (#877 Phase 2). Wraps the authenticated renter layout: a
 * renter who still owes a once-per-subject consent is blocked by a non-dismissable
 * dialog before any `_renter` page renders. The gate is inert until consent docs
 * are published (the API returns an empty list), so it no-ops in prod/e2e today.
 * Non-renters, in-flight sessions, and current renters pass straight through.
 */
export function ConsentGate({ locale, children }: ConsentGateProps) {
  const session = useSession()
  const isRenter = session.data?.user.role === RENTER_ROLE
  const { data: pending } = usePendingConsents(locale, isRenter)

  if (!isRenter || !pending || pending.length === 0) return <>{children}</>
  return <ConsentBlockingDialog pending={pending} csrfToken={session.data?.csrfToken ?? ''} />
}

interface ConsentBlockingDialogProps {
  readonly pending: readonly PendingConsent[]
  readonly csrfToken: string
}

function ConsentBlockingDialog({ pending, csrfToken }: ConsentBlockingDialogProps) {
  const t = useTranslations('consent')
  const queryClient = useQueryClient()
  const [acceptedIds, setAcceptedIds] = useState<readonly string[]>([])

  const allChecked = pending.every((p) => acceptedIds.includes(p.document.id))

  const mutation = useMutation({
    mutationFn: async () => {
      // One POST per document. Promise.all rejects on the first failure, so a
      // mid-batch error leaves some docs accepted and forces a full re-submit.
      // That replay is a no-op ONLY because the server's recordAcceptance is
      // idempotent (findExisting + unique-violation re-read, services/consent.ts):
      // never make accept non-idempotent without adding a client idempotency key.
      await Promise.all(pending.map((p) => acceptConsent(p.document.id, csrfToken)))
    },
    // Refetch status; once the subject is current the gate unmounts and the page
    // renders. Invalidate the root key so any other consent reads refresh too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONSENT_QUERY_KEY }),
  })

  const toggle = (id: string, checked: boolean) =>
    setAcceptedIds((ids) => (checked ? [...ids, id] : ids.filter((x) => x !== id)))

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('error')}
          </p>
        ) : null}
        <div className="space-y-4">
          {pending.map((p) => (
            <div
              key={p.document.id}
              className="space-y-2 rounded-lg border border-border bg-muted/30 p-4"
            >
              <h3 className="text-sm font-medium text-foreground">{p.document.title}</h3>
              <p
                id={`consent-body-${p.document.id}`}
                className="max-h-48 overflow-y-auto whitespace-pre-line text-sm text-muted-foreground"
              >
                {p.document.body}
              </p>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedIds.includes(p.document.id)}
                  onChange={(event) => toggle(p.document.id, event.target.checked)}
                  aria-describedby={`consent-body-${p.document.id}`}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
                />
                <span className="text-foreground">{p.document.acceptanceLabel}</span>
              </label>
            </div>
          ))}
        </div>
        {allChecked ? null : (
          // a11y (#638): tie the disabled button to this hint so a screen reader
          // announces why it is dead.
          <p id="consent-accept-hint" className="text-sm text-muted-foreground">
            {t('hint')}
          </p>
        )}
        <Button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!allChecked || !csrfToken || mutation.isPending}
          aria-describedby={allChecked ? undefined : 'consent-accept-hint'}
        >
          {mutation.isPending ? t('accepting') : t('accept')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
