import { Button } from '@/components/ui/button'
import { useTranslations } from 'use-intl'

interface PaymentStepProps {
  readonly onBack: () => void
}

/**
 * Step 5 (#460): the payment seam. Online payment lands with #461 (Stripe), so
 * the pay action is inert and the booking is NOT submitted from the web yet.
 * Keeping the step in place fixes the wizard's shape so #461 only has to wire
 * the POST behind the (currently disabled) confirm button.
 */
export function PaymentStep({ onBack }: PaymentStepProps) {
  const t = useTranslations('reservation')

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{t('payment.heading')}</h2>
      <p className="rounded-lg border border-dashed border-border bg-muted/40 p-4 text-muted-foreground">
        {t('payment.comingSoon')}
      </p>
      <div className="flex items-center justify-between gap-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button type="button" disabled>
          {t('payment.pay')}
        </Button>
      </div>
    </section>
  )
}
