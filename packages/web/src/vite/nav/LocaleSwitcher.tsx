import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Locale } from '@/vite/i18n/locale'
import { useNavigate } from '@tanstack/react-router'
import { Globe } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
}

/**
 * Pure (functional core): the relative TanStack navigation that swaps only the
 * `$locale` path segment, keeping the current route and search. The old Next
 * switcher used `router.replace(pathname, { locale })`; here locale is a path
 * param, so we update it in place with `to: '.'`.
 */
export function localeSwapNav(next: Locale) {
  return {
    to: '.',
    params: (prev: Record<string, unknown>) => ({ ...prev, locale: next }),
    replace: true,
  } as const
}

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const navigate = useNavigate()
  const t = useTranslations('nav')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          /* #1300: pin the width to the 44px touch floor (the base already pins the
             height). On mobile the visible label is hidden, so an sr-only span names
             the control; on sm+ the visible locale label is the name (an aria-label
             would override "English" with "Language" — WCAG 2.5.3 Label in Name). */
          <Button variant="ghost" size="sm" className="gap-1.5 pointer-coarse:min-w-11">
            <Globe className="size-4" />
            <span className="sr-only sm:hidden">{t('language')}</span>
            <span className="hidden sm:inline">{LOCALE_LABELS[locale]}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {(Object.keys(LOCALE_LABELS) as Locale[]).map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => navigate(localeSwapNav(code))}
            className={locale === code ? 'font-medium bg-accent' : ''}
          >
            {LOCALE_LABELS[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
