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
