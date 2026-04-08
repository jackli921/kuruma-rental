'use server'

import { signIn, signOut } from '@/auth'

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/en' })
}

export async function loginWithApple() {
  await signIn('apple', { redirectTo: '/en' })
}

export async function logout() {
  await signOut({ redirectTo: '/en/login' })
}

// Email/password registration — disabled for now (OAuth-first)
export async function register(_input: {
  name: string
  email: string
  password: string
}): Promise<{ success: false; error: string; errors?: Record<string, string[]> }> {
  return { success: false, error: 'Email registration is not available. Please use Google or Apple sign-in.' }
}
