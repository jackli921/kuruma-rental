'use client'

import { setViewMode } from '@/actions/view-mode'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRouter } from '@/i18n/routing'
import type { ViewMode } from '@/lib/view-mode'
import { ArrowLeftRight, LogOut } from 'lucide-react'
import type { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'

function getInitials(name: string | null | undefined): string {
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
  const { user } = session

  const targetMode: ViewMode = viewMode === 'business' ? 'renter' : 'business'
  const switchLabel = viewMode === 'business' ? t('nav.switchToRenter') : t('nav.switchToBusiness')

  async function handleSwitchView() {
    await setViewMode(targetMode)
    router.refresh()
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
          onClick={() => signOut()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="size-4 mr-2" />
          {t('auth.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
