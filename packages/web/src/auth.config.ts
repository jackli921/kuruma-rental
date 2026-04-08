import type { NextAuthConfig } from 'next-auth'
import Apple from 'next-auth/providers/apple'
import Google from 'next-auth/providers/google'

export default {
  providers: [Google, Apple],
} satisfies NextAuthConfig
