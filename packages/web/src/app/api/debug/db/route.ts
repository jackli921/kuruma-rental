import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  }

  try {
    const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] as
      | Record<string, unknown>
      | undefined
    diagnostics.cfContextExists = !!ctx
    const env = (ctx?.env ?? {}) as Record<string, string>
    diagnostics.hasDatabaseUrl = !!env.DATABASE_URL || !!process.env.DATABASE_URL
  } catch (e) {
    diagnostics.cfContextError = String(e)
  }

  try {
    const { getDb } = await import('@/lib/db')
    const db = getDb()
    const result = await db.execute(sql`SELECT 1 as ok`)
    diagnostics.dbConnection = 'success'
    diagnostics.dbResult = result
  } catch (e) {
    diagnostics.dbConnection = 'failed'
    diagnostics.dbError = String(e)
  }

  return NextResponse.json(diagnostics)
}
