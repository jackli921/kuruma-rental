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
          /* #1300: the label is hidden on mobile, leaving an icon-only trigger; pin
             the width to the 44px touch floor (the base already pins the height) and
             give it an aria-label so the control still has a name without the text. */
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 pointer-coarse:min-w-11"
            aria-label={t('language')}
          >
            <Globe className="size-4" />
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
