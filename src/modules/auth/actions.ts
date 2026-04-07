'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { registerSchema } from '@/lib/validations/auth'

type RegisterResult =
  | { success: true }
  | { success: false; error?: string; errors?: Record<string, string[]> }

export async function register(input: {
  name: string
  email: string
  password: string
}): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input)

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const { name, email, password } = parsed.data
  const supabase = await createServerClient()

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  })

  if (signUpError || !data.user) {
    return {
      success: false,
      error: signUpError?.message ?? 'Registration failed',
    }
  }

  const db = getDb()

  try {
    await db.insert(users).values({
      supabaseAuthId: data.user.id,
      email,
      name,
      role: 'RENTER',
    })
  } catch {
    await supabase.auth.admin.deleteUser(data.user.id)
    return {
      success: false,
      error: 'Registration failed. Please try again.',
    }
  }

  redirect('/en')
}
