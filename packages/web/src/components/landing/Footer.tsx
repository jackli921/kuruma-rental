import { Separator } from '@/components/ui/separator'
import { useTranslations } from 'next-intl'

export function Footer() {
  const t = useTranslations('landing.footer')
  const year = new Date().getFullYear()

  return (
    <footer className="px-4 pb-8">
      <div className="max-w-7xl mx-auto">
        <Separator className="mb-8" />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>
            &copy; {year} {t('copyright')}
          </p>
          <p>{t('tagline')}</p>
        </div>
      </div>
    </footer>
  )
}
