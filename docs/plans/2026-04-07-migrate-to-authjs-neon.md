# Migrate from Supabase to Auth.js + Neon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **NOTE:** This plan was written before the monorepo split decision (2026-04-07). File paths reference the flat `src/` structure. When executing, map paths to the new monorepo layout:
> - `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` → `packages/web/src/`
> - `src/db/schema.ts` → `packages/shared/src/db/schema.ts`
> - `src/modules/auth/` → `packages/web/src/modules/auth/`
> - `src/app/` → `packages/web/src/app/`
> - `src/lib/supabase/` → DELETE (no monorepo equivalent)
> - `tests/` → `packages/web/tests/`
>
> See `docs/2026-04-02-kuruma-mvp-design.md` for the full monorepo structure.

**Goal:** Replace Supabase Auth + Supabase Postgres with Auth.js v5 (NextAuth) + Neon Postgres, keeping Drizzle ORM and all existing functionality (Google/Apple OAuth, user profile creation).

**Architecture:** Auth.js v5 handles OAuth flows, session management, and stores auth data (users, accounts, sessions) via its Drizzle adapter directly in our Neon Postgres database. This eliminates the Supabase dependency entirely. The `users` table is extended to serve both Auth.js and our app's profile data. Middleware checks the Auth.js session instead of refreshing a Supabase session.

**Tech Stack:** next-auth v5, @auth/drizzle-adapter, Neon Postgres (via postgres.js driver we already have), Drizzle ORM

---

## File Structure

```
kuruma-rental/
├── src/
│   ├── auth.ts                            # Auth.js config (providers, adapter, callbacks)
│   ├── auth.config.ts                     # Auth.js edge config (for middleware)
│   ├── middleware.ts                       # MODIFY: next-intl + Auth.js session check
│   ├── db/
│   │   ├── index.ts                       # KEEP: getDb() unchanged
│   │   └── schema.ts                      # MODIFY: Auth.js tables + app profile fields
│   ├── modules/auth/
│   │   ├── actions.ts                     # REWRITE: signIn/signOut via Auth.js
│   │   ├── OAuthButtons.tsx               # REWRITE: use Auth.js signIn()
│   │   ├── oauth.ts                       # DELETE: replaced by Auth.js built-in
│   │   ├── callback.ts                    # DELETE: replaced by Auth.js built-in
│   │   └── RegisterForm.tsx               # KEEP: disabled, no changes needed
│   ├── app/
│   │   ├── api/auth/
│   │   │   ├── callback/route.ts          # DELETE: Auth.js handles this
│   │   │   └── [...nextauth]/route.ts     # CREATE: Auth.js API route handler
│   │   └── [locale]/(auth)/
│   │       ├── login/page.tsx             # KEEP: minor update
│   │       └── callback/page.tsx          # DELETE: Auth.js handles redirects
│   └── lib/
│       ├── supabase/                      # DELETE: entire directory
│       └── validations/auth.ts            # KEEP: unchanged
├── tests/
│   └── modules/auth/
│       ├── actions.test.ts                # REWRITE: test Auth.js actions
│       ├── oauth.test.ts                  # DELETE: no longer needed
│       └── callback.test.ts              # DELETE: no longer needed
├── drizzle.config.ts                      # KEEP: update DATABASE_URL source if needed
└── .env.example                           # MODIFY: new env vars
```

---

### Task 1: Swap Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove Supabase packages**

```bash
cd /Users/jack/Dev/kuruma-rental
bun remove @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Install Auth.js + Drizzle adapter**

```bash
bun add next-auth@beta @auth/drizzle-adapter
```

Note: Auth.js v5 is published under the `beta` tag for the Next.js integration.

- [ ] **Step 3: Verify install succeeded**

```bash
bun run build
```

Expected: Build will fail (Supabase imports still referenced). That's fine — we'll fix those in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: swap Supabase for Auth.js + Drizzle adapter"
```

---

### Task 2: Update Drizzle Schema for Auth.js

**Files:**
- Modify: `src/db/schema.ts`

Auth.js with the Drizzle adapter requires specific tables: `users`, `accounts`, `sessions`, `verificationTokens`. We merge our app's profile fields (role, language, country, avatarUrl) into the Auth.js `users` table.

- [ ] **Step 1: Write the new schema**

Replace `src/db/schema.ts` with:

```typescript
import { pgEnum, pgTable, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

export const roleEnum = pgEnum('role', ['RENTER', 'STAFF', 'ADMIN'])

// Auth.js required fields + app profile fields
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  // App-specific profile fields
  role: roleEnum('role').notNull().default('RENTER'),
  language: text('language').notNull().default('en'),
  country: text('country'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const accounts = pgTable('accounts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccountType>().notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'),
  access_token: text('access_token'),
  expires_at: integer('expires_at'),
  token_type: text('token_type'),
  scope: text('scope'),
  id_token: text('id_token'),
  session_state: text('session_state'),
}, (account) => [
  primaryKey({ columns: [account.provider, account.providerAccountId] }),
])

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
}, (vt) => [
  primaryKey({ columns: [vt.identifier, vt.token] }),
])
```

- [ ] **Step 2: Remove cuid2 dependency**

Auth.js uses its own ID generation. We switched to `crypto.randomUUID()`.

```bash
bun remove @paralleldrive/cuid2
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts package.json bun.lock
git commit -m "refactor: update schema for Auth.js tables"
```

---

### Task 3: Create Auth.js Configuration

**Files:**
- Create: `src/auth.ts`
- Create: `src/auth.config.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create edge config (used by middleware)**

Create `src/auth.config.ts`:

```typescript
import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'
import Apple from 'next-auth/providers/apple'

export default {
  providers: [
    Google,
    Apple,
  ],
} satisfies NextAuthConfig
```

- [ ] **Step 2: Create main auth config**

Create `src/auth.ts`:

```typescript
import NextAuth from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { getDb } from '@/db'
import authConfig from './auth.config'

const db = getDb()

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/en/login',
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role ?? 'RENTER'
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
  ...authConfig,
})
```

- [ ] **Step 3: Create API route handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from '@/auth'

export const { GET, POST } = handlers
```

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts src/auth.config.ts "src/app/api/auth/[...nextauth]/route.ts"
git commit -m "feat: add Auth.js config with Google/Apple providers"
```

---

### Task 4: Rewrite Auth Module

**Files:**
- Rewrite: `src/modules/auth/actions.ts`
- Rewrite: `src/modules/auth/OAuthButtons.tsx`
- Delete: `src/modules/auth/oauth.ts`
- Delete: `src/modules/auth/callback.ts`

- [ ] **Step 1: Rewrite server actions**

Replace `src/modules/auth/actions.ts` with:

```typescript
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
```

- [ ] **Step 2: Rewrite OAuth buttons**

Replace `src/modules/auth/OAuthButtons.tsx` with:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { loginWithGoogle, loginWithApple } from './actions'

export function OAuthButtons() {
  const t = useTranslations('auth')

  return (
    <div className="flex flex-col gap-3">
      <form action={loginWithGoogle}>
        <Button variant="outline" className="w-full" type="submit">
          {t('google')}
        </Button>
      </form>

      <form action={loginWithApple}>
        <Button variant="outline" className="w-full" type="submit">
          {t('apple')}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Delete old files**

```bash
rm src/modules/auth/oauth.ts
rm src/modules/auth/callback.ts
rm src/app/api/auth/callback/route.ts
rm "src/app/[locale]/(auth)/callback/page.tsx"
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/ "src/app/api/auth/" "src/app/[locale]/(auth)/"
git commit -m "refactor: rewrite auth module for Auth.js"
```

---

### Task 5: Update Middleware

**Files:**
- Modify: `src/middleware.ts`

The middleware needs to handle both next-intl locale routing and Auth.js session refresh. Auth.js v5 exports a middleware-compatible `auth()` function.

- [ ] **Step 1: Rewrite middleware**

Replace `src/middleware.ts` with:

```typescript
import createIntlMiddleware from 'next-intl/middleware'
import { auth } from '@/auth'
import { routing } from './i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

export default auth((req) => {
  return intlMiddleware(req)
})

export const config = {
  matcher: ['/', '/(en|ja|zh)/:path*'],
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "refactor: update middleware for Auth.js + next-intl"
```

---

### Task 6: Clean Up Supabase References

**Files:**
- Delete: `src/lib/supabase/client.ts`
- Delete: `src/lib/supabase/server.ts`
- Delete: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Delete Supabase client files**

```bash
rm -r src/lib/supabase/
```

- [ ] **Step 2: Verify no remaining Supabase imports**

```bash
grep -r "supabase" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: No results. If any files still reference Supabase, fix them.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/
git commit -m "chore: remove Supabase client files"
```

---

### Task 7: Rewrite Tests

**Files:**
- Rewrite: `tests/modules/auth/actions.test.ts`
- Delete: `tests/modules/auth/oauth.test.ts`
- Delete: `tests/modules/auth/callback.test.ts`

- [ ] **Step 1: Delete obsolete test files**

```bash
rm tests/modules/auth/oauth.test.ts
rm tests/modules/auth/callback.test.ts
```

- [ ] **Step 2: Write new action tests**

Replace `tests/modules/auth/actions.test.ts` with:

```typescript
import { describe, expect, it, vi } from 'vitest'

const mockSignIn = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/auth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}))

describe('auth actions', () => {
  it('loginWithGoogle calls signIn with google provider', async () => {
    const { loginWithGoogle } = await import('@/modules/auth/actions')
    await loginWithGoogle()

    expect(mockSignIn).toHaveBeenCalledWith('google', { redirectTo: '/en' })
  })

  it('loginWithApple calls signIn with apple provider', async () => {
    const { loginWithApple } = await import('@/modules/auth/actions')
    await loginWithApple()

    expect(mockSignIn).toHaveBeenCalledWith('apple', { redirectTo: '/en' })
  })

  it('logout calls signOut with redirect', async () => {
    const { logout } = await import('@/modules/auth/actions')
    await logout()

    expect(mockSignOut).toHaveBeenCalledWith({ redirectTo: '/en/login' })
  })
})
```

- [ ] **Step 3: Run tests**

```bash
bunx vitest run
```

Expected: All tests pass (smoke + validation + new auth action tests).

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: rewrite auth tests for Auth.js"
```

---

### Task 8: Update Environment Variables

**Files:**
- Modify: `.env.example`
- Modify: `.env` (manually, not committed)

- [ ] **Step 1: Update .env.example**

Replace contents with:

```
# Auth.js
AUTH_SECRET=generate-with-openssl-rand-base64-32
AUTH_GOOGLE_ID=your-google-client-id
AUTH_GOOGLE_SECRET=your-google-client-secret
AUTH_APPLE_ID=your-apple-service-id
AUTH_APPLE_SECRET=your-apple-private-key

# Database (Neon Postgres)
DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require

# Google Cloud Translation (Phase 4)
GOOGLE_CLOUD_TRANSLATION_API_KEY=your-key
```

- [ ] **Step 2: Generate AUTH_SECRET locally**

```bash
openssl rand -base64 32
```

Copy the output into your `.env` file as `AUTH_SECRET`.

- [ ] **Step 3: Update .env with Neon DATABASE_URL and Google OAuth credentials**

Get these from:
- Neon dashboard: connection string
- Google Cloud Console: OAuth 2.0 Client ID + Secret

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: update env vars for Auth.js + Neon"
```

---

### Task 9: Verify Full Build and Tests

- [ ] **Step 1: Run tests**

```bash
bunx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Run build**

```bash
bun run build
```

Expected: Build succeeds with routes `/[locale]`, `/[locale]/login`, `/[locale]/register`, `/api/auth/[...nextauth]`.

- [ ] **Step 3: Run dev server and verify login page loads**

```bash
bun run dev
```

Visit `http://localhost:3000/en/login` — should show Google and Apple buttons.

- [ ] **Step 4: Run Drizzle migration against Neon (if credentials configured)**

```bash
bun run db:generate
bun run db:migrate
```

This creates the Auth.js tables in your Neon database.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve build issues from auth migration"
```

---

## Summary of Changes

| Before (Supabase) | After (Auth.js + Neon) |
|---|---|
| `@supabase/supabase-js` + `@supabase/ssr` | `next-auth` + `@auth/drizzle-adapter` |
| 3 Supabase client files | 2 Auth.js config files |
| Custom OAuth action + callback handler | Auth.js built-in OAuth flow |
| `supabaseAuthId` on users table | Auth.js `accounts` table links providers |
| Supabase Postgres | Neon Postgres (same driver) |
| 8 auth tests | 12 tests (validation stays, auth actions simplified) |

## HITL Required

Before the OAuth flow works end-to-end:
1. Create Neon account + project at neon.tech
2. Get Google OAuth credentials from Google Cloud Console
3. Configure `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `DATABASE_URL`, `AUTH_SECRET` in `.env`
4. Run `bun run db:generate && bun run db:migrate` to create tables
5. (Optional) Apple OAuth credentials — can defer
