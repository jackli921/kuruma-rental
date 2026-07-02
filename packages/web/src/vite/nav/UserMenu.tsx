import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isPlatformAdmin } from '@/lib/platform-roles'
import { useViewModeContext } from '@/vite/ViewModeProvider'
import { type Session, signOut } from '@/vite/session'
import type { ViewMode } from '@/vite/view-mode'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { ArrowLeftRight, LogOut, Shield } from 'lucide-react'
import { useLocale, useTranslations } from 'use-intl'

export function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface UserMenuProps {
  readonly session: Session
  readonly canSwitchView: boolean
  readonly viewMode: ViewMode
}

export function UserMenu({ session, canSwitchView, viewMode }: UserMenuProps) {
  const t = useTranslations()
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const { setViewMode } = useViewModeContext()
  const { user } = session

  const targetMode: ViewMode = viewMode === 'business' ? 'renter' : 'business'
  const switchLabel = viewMode === 'business' ? t('nav.switchToRenter') : t('nav.switchToBusiness')

  // The context setter writes the `kuruma-view` cookie AND updates React state, so
  // every viewMode consumer (nav tabs, business sidebar) re-renders immediately —
  // no page reload, unlike the old cookie-write + router.invalidate() (#1274).
  function handleSwitchView() {
    setViewMode(targetMode)
  }

  // After the cookie is cleared, drop the cached session and re-run the route
  // guards, which redirect the now-anonymous user to login.
  async function handleSignOut() {
    await signOut(session.csrfToken)
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    await router.invalidate()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2 px-1.5">
            <Avatar className="size-7">
              <AvatarImage src={user.image ?? undefined} alt={user.name ?? ''} />
              <AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden sm:inline text-sm">{user.name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        {isPlatformAdmin(user.role) && (
          <>
            <DropdownMenuItem
              render={
                <Link to="/$locale/admin" params={{ locale }} className="cursor-pointer">
                  <Shield className="size-4 mr-2" />
                  {t('admin.home.title')}
                </Link>
              }
            />
            <DropdownMenuSeparator />
          </>
        )}
        {canSwitchView && (
          <>
            <DropdownMenuItem onClick={handleSwitchView} className="cursor-pointer">
              <ArrowLeftRight className="size-4 mr-2" />
              {switchLabel}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="size-4 mr-2" />
          {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
