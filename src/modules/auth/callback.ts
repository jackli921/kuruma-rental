import { eq } from 'drizzle-orm'
import { createServerClient } from '@/lib/supabase/server'
import { getDb } from '@/db'
import { users } from '@/db/schema'

type CallbackResult =
  | { success: true }
  | { success: false; error: string }

export async function handleOAuthCallback(code: string): Promise<CallbackResult> {
  const supabase = await createServerClient()

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    return { success: false, error: exchangeError.message }
  }

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Failed to get user after OAuth' }
  }

  const db = getDb()

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.supabaseAuthId, user.id))

  if (existing.length === 0) {
    const name = user.user_metadata?.full_name ?? user.email ?? 'User'

    await db.insert(users).values({
      supabaseAuthId: user.id,
      email: user.email!,
      name,
      role: 'RENTER',
    })
  }

  return { success: true }
}
