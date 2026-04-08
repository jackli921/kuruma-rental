import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'
import Apple from 'next-auth/providers/apple'

export default {
  providers: [
    Google,
    Apple,
  ],
} satisfies NextAuthConfig
