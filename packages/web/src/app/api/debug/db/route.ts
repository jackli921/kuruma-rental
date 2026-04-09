import { NextResponse } from 'next/server'

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    processEnvKeys: Object.keys(process.env).filter((k) =>
      ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_TRUST_HOST'].includes(k),
    ),
  }

  // Check CF context
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[
      Symbol.for('__cloudflare-context__')
    ] as Record<string, unknown> | undefined
    diagnostics.cfContextExists = !!ctx
    diagnostics.cfEnvKeys = ctx?.env
      ? Object.keys(ctx.env as Record<string, unknown>).filter(
          (k) => !k.startsWith('__'),
        )
      : null
    const env = ctx?.env as Record<string, string> | undefined
    diagnostics.hasDatabaseUrl = !!env?.DATABASE_URL
    diagnostics.dbUrlPrefix = env?.DATABASE_URL?.substring(0, 15) ?? null
  } catch (e) {
    diagnostics.cfContextError = String(e)
  }

  // Try DB connection
  try {
    const { getDb } = await import('@/lib/db')
    const db = getDb()
    const result = await db.execute(
      // biome-ignore lint/suspicious/noExplicitAny: raw SQL for diagnostics
      { sql: 'SELECT 1 as ok' } as any,
    )
    diagnostics.dbConnection = 'success'
    diagnostics.dbResult = result
  } catch (e) {
    diagnostics.dbConnection = 'failed'
    diagnostics.dbError = String(e)
  }

  return NextResponse.json(diagnostics)
}
