'use client'

import { Button, buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { LogOut, Menu } from 'lucide-react'
import type { Session } from 'next-auth'
import { signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

interface NavItem {
  readonly href: string
  readonly label: string
}

interface MobileMenuProps {
  readonly session: Session | null
  readonly navItems: readonly NavItem[]
}

export function MobileMenu({ session, navItems }: MobileMenuProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">{t('nav.menu')}</span>
          </Button>
        }
      />
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>{t('common.appName')}</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 mt-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {session ? (
          <>
            <Separator className="my-4" />
            <div className="px-3">
              <p className="text-sm font-medium">{session.user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-2 px-3 py-2 mt-2 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors w-full"
            >
              <LogOut className="size-4" />
              {t('auth.logout')}
            </button>
          </>
        ) : (
          <>
            <Separator className="my-4" />
            <div className="flex flex-col gap-2 px-3">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
              >
                {t('auth.login')}
              </Link>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
              >
                {t('auth.register')}
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
