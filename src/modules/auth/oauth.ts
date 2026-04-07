'use server'

import { headers } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'

type OAuthProvider = 'google' | 'apple'

type OAuthResult =
  | { success: true; url: string }
  | { success: false; error: string }

export async function loginWithOAuth(provider: OAuthProvider): Promise<OAuthResult> {
  const headerStore = await headers()
  const origin = headerStore.get('origin') ?? headerStore.get('host') ?? ''

  const supabase = await createServerClient()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/api/auth/callback`,
    },
  })

  if (error || !data.url) {
    return {
      success: false,
      error: error?.message ?? 'Failed to initiate OAuth',
    }
  }

  return { success: true, url: data.url }
}
