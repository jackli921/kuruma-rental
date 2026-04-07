import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { handleOAuthCallback } from '@/modules/auth/callback'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/en/login?error=missing_code', request.url))
  }

  const result = await handleOAuthCallback(code)

  if (!result.success) {
    return NextResponse.redirect(new URL('/en/login?error=auth_failed', request.url))
  }

  return NextResponse.redirect(new URL('/en', request.url))
}
