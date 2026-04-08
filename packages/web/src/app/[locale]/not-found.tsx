import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export default function NotFound() {
  const t = useTranslations('errors.notFound')

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-base text-muted-foreground">{t('description')}</p>
        <div className="mt-8">
          <Link href="/" className={cn(buttonVariants({ variant: 'default' }))}>
            {t('backHome')}
          </Link>
        </div>
      </div>
    </main>
  )
}
