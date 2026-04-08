'use client'

import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import type { Session } from 'next-auth'
import { useTranslations } from 'next-intl'
import { UserMenu } from './UserMenu'

interface NavbarClientProps {
  readonly session: Session | null
}

export function NavbarClient({ session }: NavbarClientProps) {
  const t = useTranslations('auth')

  if (session) {
    return <UserMenu session={session} />
  }

  return (
    <div className="hidden md:flex items-center gap-2">
      <Link href="/login" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        {t('login')}
      </Link>
      <Link href="/register" className={cn(buttonVariants({ size: 'sm' }))}>
        {t('register')}
      </Link>
    </div>
  )
}
