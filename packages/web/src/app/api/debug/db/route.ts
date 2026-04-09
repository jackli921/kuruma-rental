import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
  }

  // Check CF context
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[
      Symbol.for('__cloudflare-context__')
    ] as Record<string, unknown> | undefined
    diagnostics.cfContextExists = !!ctx
    const env = ctx?.env as Record<string, string> | undefined
    diagnostics.hasDatabaseUrl = !!env?.DATABASE_URL
    diagnostics.dbUrlPrefix = env?.DATABASE_URL?.substring(0, 20) ?? null
  } catch (e) {
    diagnostics.cfContextError = String(e)
  }

  // Try DB connection with correct Drizzle syntax
  try {
    const { getDb } = await import('@/lib/db')
    const db = getDb()
    const result = await db.execute(sql`SELECT 1 as ok`)
    diagnostics.dbConnection = 'success'
    diagnostics.dbResult = result
  } catch (e) {
    diagnostics.dbConnection = 'failed'
    diagnostics.dbError = String(e)
    diagnostics.dbStack = e instanceof Error ? e.stack?.split('\n').slice(0, 5) : null
  }

  return NextResponse.json(diagnostics)
}
