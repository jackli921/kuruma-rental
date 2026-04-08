import { auth } from '@/auth'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { getViewMode, isBusiness } from '@/lib/view-mode'
import { Car } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { LocaleSwitcher } from './LocaleSwitcher'
import { MobileMenu } from './MobileMenu'
import { NavbarClient } from './NavbarClient'

async function getSession() {
  try {
    return await auth()
  } catch {
    // Auth may fail on CF Workers if DB is unreachable.
    // Treat as unauthenticated rather than crashing the page.
    return null
  }
}

export async function Navbar() {
  const [session, t] = await Promise.all([getSession(), getTranslations('nav')])

  const role = session?.user?.role
  const canSwitchView = isBusiness(role)
  const viewMode = await getViewMode(role)

  const publicItems = [{ href: '/vehicles' as const, label: t('vehicles') }]

  const renterItems = [
    { href: '/bookings' as const, label: t('bookings') },
    { href: '/messages' as const, label: t('messages') },
  ]

  const businessItems = [
    { href: '/dashboard' as const, label: t('dashboard') },
    { href: '/manage/bookings' as const, label: t('bookings') },
    { href: '/manage/vehicles' as const, label: t('fleet') },
    { href: '/manage/customers' as const, label: t('customers') },
    { href: '/manage/messages' as const, label: t('messages') },
  ]

  const navItems =
    viewMode === 'business'
      ? businessItems
      : [...publicItems, ...(session?.user ? renterItems : [])]

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Car className="size-5" />
            <span className="hidden sm:inline">Kuruma</span>
          </Link>

          {/* Desktop nav -- hidden for business users when sidebar is present (CSS :has() rule) */}
          <nav
            className="hidden md:flex items-center gap-1"
            {...(viewMode === 'business' && { 'data-business-nav': '' })}
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <NavbarClient
              session={session}
              canSwitchView={canSwitchView}
              viewMode={viewMode}
            />
            <MobileMenu session={session} navItems={navItems} />
          </div>
        </div>
      </div>
    </header>
  )
}
