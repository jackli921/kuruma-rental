import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ExternalLink, ShieldCheck } from 'lucide-react'

interface PreAuthHandoffCardProps {
  /** Operator's external pre-auth URL; `null` => operator has none, render nothing. */
  readonly url: string | null
  readonly title: string
  readonly explain: string
  readonly ctaLabel: string
  readonly cancellationContact: string
}

/**
 * Renter-facing pre-auth handoff CTA (#393, §5.1). Links to the operator's
 * EXTERNAL pre-auth page, so it uses a plain `<a target="_blank" rel="noopener
 * noreferrer">` — never the router `Link`. Pure presentational (strings in, JSX
 * out); the confirmation route resolves i18n and ownership. A `null` url hides the
 * card entirely rather than rendering a dead link (proposal §8.1: tourist UX).
 */
export function PreAuthHandoffCard({
  url,
  title,
  explain,
  ctaLabel,
  cancellationContact,
}: PreAuthHandoffCardProps) {
  if (!url) return null

  return (
    <Card className="mt-4 border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{explain}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'default' }), 'w-full justify-center sm:w-auto')}
        >
          {ctaLabel}
          <ExternalLink className="ml-2 size-4" />
        </a>
        <p className="text-xs text-muted-foreground">{cancellationContact}</p>
      </CardContent>
    </Card>
  )
}
