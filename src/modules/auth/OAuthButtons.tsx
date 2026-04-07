'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { loginWithOAuth } from './oauth'

export function OAuthButtons() {
  const t = useTranslations('auth')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleOAuth(provider: 'google' | 'apple') {
    setPending(provider)
    setError(null)

    const result = await loginWithOAuth(provider)

    if (result.success) {
      window.location.href = result.url
    } else {
      setError(result.error)
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        variant="outline"
        className="w-full"
        disabled={pending !== null}
        onClick={() => handleOAuth('google')}
      >
        {pending === 'google' ? '...' : t('google')}
      </Button>

      <Button
        variant="outline"
        className="w-full"
        disabled={pending !== null}
        onClick={() => handleOAuth('apple')}
      >
        {pending === 'apple' ? '...' : t('apple')}
      </Button>
    </div>
  )
}
