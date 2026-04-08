'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname, useRouter } from '@/i18n/routing'
import { Globe } from 'lucide-react'
import { useLocale } from 'next-intl'

const LOCALE_LABELS = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
} as const

type Locale = keyof typeof LOCALE_LABELS

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()

  function handleLocaleChange(nextLocale: Locale) {
    router.replace(pathname, { locale: nextLocale })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5">
            <Globe className="size-4" />
            <span className="hidden sm:inline">{LOCALE_LABELS[locale]}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {(Object.entries(LOCALE_LABELS) as [Locale, string][]).map(([code, label]) => (
          <DropdownMenuItem
            key={code}
            onClick={() => handleLocaleChange(code)}
            className={locale === code ? 'font-medium bg-accent' : ''}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
