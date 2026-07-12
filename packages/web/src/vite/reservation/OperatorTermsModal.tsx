import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PublishedOperatorTerms } from '@/vite/operator-terms'
import { useTranslations } from 'use-intl'

interface OperatorTermsModalProps {
  readonly terms: PublishedOperatorTerms
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onAgree: () => void
  readonly pending: boolean
}

/**
 * #877 Slice B: clickwrap for the operator's published rental terms, shown on
 * Reserve. The renter reads the exact `title`/`body` that will be sealed and
 * signed, then agrees. The agree label is the operator's own `acceptanceLabel`
 * (not an app string) so the recorded consent matches what they clicked. The
 * DialogContent scroll region caps at 90dvh (#1298), so a long terms body scrolls
 * while the agree/cancel footer stays pinned.
 */
export function OperatorTermsModal({
  terms,
  open,
  onOpenChange,
  onAgree,
  pending,
}: OperatorTermsModalProps) {
  const t = useTranslations('reservation')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{terms.title}</DialogTitle>
          <DialogDescription>{t('operatorTerms.description')}</DialogDescription>
        </DialogHeader>
        <div className="whitespace-pre-wrap text-sm text-foreground">{terms.body}</div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('operatorTerms.cancel')}
          </Button>
          <Button type="button" onClick={onAgree} disabled={pending}>
            {pending ? t('payment.submitting') : terms.acceptanceLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
