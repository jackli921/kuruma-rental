import { Button, buttonVariants } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { NavBadge } from '@/vite/nav/NavBadge'
import type { BusinessNavTo } from '@/vite/nav/business-nav-items'
import { type Session, signOut } from '@/vite/session'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import { LogOut, Menu } from 'lucide-react'
import { useState } from 'react'
import { useLocale, useTranslations } from 'use-intl'

// `to` is a literal union of real routes so the typed TanStack <Link> compiles;
// a plain `string` here would fail typecheck. The business-view routes come from
// the shared `businessNavItems` array (#603) so the union can't drift from the
// list Navbar renders; the renter routes (#543: Browse + Documents alongside My
// Bookings) are listed inline since they aren't part of the operator portal.
export type NavTo = BusinessNavTo | '/$locale/bookings' | '/$locale/search' | '/$locale/documents'

export interface NavItem {
  readonly to: NavTo
  readonly label: string
  // #611: optional red-dot count (the operator "new orders" alert on Bookings).
  readonly badge?: number
}

interface MobileMenuProps {
  readonly session: Session | null
  readonly navItems: readonly NavItem[]
}

export function MobileMenu({ session, navItems }: MobileMenuProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()

  // Mirror UserMenu: clear the cookie session then re-run guards, which bounce
  // the now-anonymous user to login.
  async function handleSignOut() {
    if (!session) return
    await signOut(session.csrfToken)
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    await router.invalidate()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" className="md:hidden" data-mobile-menu="">
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
              key={item.to}
              to={item.to}
              params={{ locale }}
              onClick={() => setOpen(false)}
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {item.label}
              {item.badge ? (
                <NavBadge count={item.badge} label={t('nav.newBookings', { count: item.badge })} />
              ) : null}
            </Link>
          ))}
        </nav>
        {session?.user ? (
          <>
            <Separator className="my-4" />
            <div className="px-3">
              <p className="text-sm font-medium">{session.user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
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
                to="/$locale/login"
                params={{ locale }}
                onClick={() => setOpen(false)}
                className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
              >
                {t('auth.login')}
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
