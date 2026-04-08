'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { getErrorMessage } from '@/lib/error-helpers'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

interface ErrorPageProps {
  readonly error: Error & { digest?: string }
  readonly reset: () => void
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const t = useTranslations('errors.generic')

  if (process.env.NODE_ENV === 'development') {
    console.error(error)
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-sm font-medium text-destructive">Error</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-base text-muted-foreground">
          {process.env.NODE_ENV === 'development' ? getErrorMessage(error) : t('description')}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button onClick={reset}>{t('retry')}</Button>
          <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            {t('backHome')}
          </Link>
        </div>
      </div>
    </main>
  )
}
