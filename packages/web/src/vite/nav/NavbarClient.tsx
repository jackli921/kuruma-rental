import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLayoutPreference } from '@/vite/LayoutPreferenceProvider'
import { UserMenu } from '@/vite/nav/UserMenu'
import type { Session } from '@/vite/session'
import type { ViewMode } from '@/vite/view-mode'
import { Link } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

interface NavbarClientProps {
  readonly session: Session | null
  readonly canSwitchView: boolean
  readonly viewMode: ViewMode
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

export function NavbarClient({ session, canSwitchView, viewMode }: NavbarClientProps) {
  const t = useTranslations('auth')
  const locale = useLocale()

  if (session?.user) {
    return (
      <div className="flex items-center gap-1">
        {viewMode === 'business' && <LayoutToggle />}
        <UserMenu session={session} canSwitchView={canSwitchView} viewMode={viewMode} />
      </div>
    )
  }

  return (
    <div className="hidden md:flex items-center gap-2">
      <Link
        to="/$locale/login"
        params={{ locale }}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
      >
        {t('login')}
      </Link>
    </div>
  )
}
