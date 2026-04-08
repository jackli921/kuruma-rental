'use client'

import { useLayoutPreference } from '@/components/providers/LayoutPreferenceProvider'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { PanelLeft } from 'lucide-react'
import type { Session } from 'next-auth'
import { useTranslations } from 'next-intl'
import { UserMenu } from './UserMenu'

interface NavbarClientProps {
  readonly session: Session | null
  readonly isBusiness?: boolean
}

function LayoutToggle() {
  const { preference, toggle } = useLayoutPreference()

  return (
    <button
      type="button"
      onClick={toggle}
      className="hidden md:inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      title={preference === 'sidebar' ? 'Switch to top navigation' : 'Switch to sidebar'}
    >
      <PanelLeft className={cn('size-4', preference === 'sidebar' && 'text-foreground')} />
    </button>
  )
}

export function NavbarClient({ session, isBusiness }: NavbarClientProps) {
  const t = useTranslations('auth')

  if (session) {
    return (
      <div className="flex items-center gap-1">
        {isBusiness && <LayoutToggle />}
        <UserMenu session={session} />
      </div>
    )
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
