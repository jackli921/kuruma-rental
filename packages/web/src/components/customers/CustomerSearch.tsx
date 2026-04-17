'use client'

import { Input } from '@/components/ui/input'
import { useRouter } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const DEBOUNCE_MS = 250

export function CustomerSearch({ defaultValue }: { defaultValue: string }) {
  const t = useTranslations('business.customers')
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (value === defaultValue) return
      const params = new URLSearchParams()
      if (value.trim()) params.set('search', value.trim())
      router.replace(`/manage/customers${params.toString() ? `?${params.toString()}` : ''}`)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value, defaultValue, router])

  return (
    <Input
      type="search"
      aria-label={t('searchPlaceholder')}
      placeholder={t('searchPlaceholder')}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="max-w-sm"
    />
  )
}
