'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut } from 'lucide-react'
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
}

export function UserMenu({ session }: UserMenuProps) {
  const t = useTranslations('auth')
  const { user } = session

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
        <DropdownMenuItem
          onClick={() => signOut()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="size-4 mr-2" />
          {t('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
