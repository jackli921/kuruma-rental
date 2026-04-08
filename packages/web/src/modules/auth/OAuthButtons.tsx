'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { loginWithApple, loginWithGoogle } from './actions'

export function OAuthButtons() {
  const t = useTranslations('auth')

  return (
    <div className="flex flex-col gap-3">
      <form action={loginWithGoogle}>
        <Button variant="outline" className="w-full" type="submit">
          {t('google')}
        </Button>
      </form>

      <form action={loginWithApple}>
        <Button variant="outline" className="w-full" type="submit">
          {t('apple')}
        </Button>
      </form>
    </div>
  )
}
