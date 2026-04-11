'use server'

import type { ViewMode } from '@/lib/view-mode'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'kuruma-view'

export async function setViewMode(mode: ViewMode): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, mode, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
}
