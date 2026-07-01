import { Separator } from '@/components/ui/separator'
import { Link } from '@tanstack/react-router'
import { useLocale, useTranslations } from 'use-intl'

// Footer navigation. Links target only routes that exist today (the search
// funnel, the category catalog, and sign-in) so we never manufacture a new dead
// link. Legal pages (Terms/Privacy/Contact) are a separate follow-up.
const LINKS = [
  { to: '/$locale/search', key: 'browse' },
  { to: '/$locale/vehicles', key: 'categories' },
  { to: '/$locale/login', key: 'signIn' },
] as const

export function Footer() {
  const t = useTranslations('landing.footer')
  const locale = useLocale()
  const year = new Date().getFullYear()

  return (
    <footer className="px-4 pb-8">
      <div className="max-w-7xl mx-auto">
        <Separator className="mb-8" />
        <nav className="mb-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm sm:justify-start">
          {LINKS.map((link) => (
            <Link
              key={link.key}
              to={link.to}
              params={{ locale }}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>
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
