# Monorepo Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the flat Next.js project into a Bun workspace monorepo with three packages (`shared`, `api`, `web`) so the booking API can be deployed and consumed independently of the frontend.

**Architecture:** Martin Fowler's "Parallel Change" (expand-contract) — create the new package structure alongside the existing code, move modules one at a time, verify tests pass after each move, then remove the old locations. No big-bang rewrite.

**Tech Stack:** Bun workspaces, Hono (API), Next.js (web), Drizzle ORM + Zod (shared), Biome (replaces ESLint + Prettier)

**Branch:** `refactor/monorepo-split` in worktree at `/Users/jack/Dev/kuruma-rental-monorepo-split`

**TDD approach:** Every task ends with `bun run test` (or `bun run --filter <pkg> test`) passing. Existing tests are the safety net — they must pass at every step. New packages get their own test suites.

---

## File Structure (target state)

```
kuruma-rental/
├── packages/
│   ├── shared/
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle schema (moved from src/db/schema.ts)
│   │   │   │   └── index.ts           # DB connection factory (moved from src/db/index.ts)
│   │   │   ├── validators/
│   │   │   │   └── auth.ts            # Zod schemas (moved from src/lib/validations/auth.ts)
│   │   │   └── index.ts               # Barrel export
│   │   ├── tests/
│   │   │   ├── db/
│   │   │   │   └── schema.test.ts     # Schema smoke tests
│   │   │   └── validators/
│   │   │       └── auth.test.ts       # Moved from tests/lib/validations/auth.test.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts               # Hono app entry point
│   │   │   └── routes/
│   │   │       └── health.ts          # Health check route (skeleton)
│   │   ├── tests/
│   │   │   └── routes/
│   │   │       └── health.test.ts     # Health check test
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── wrangler.toml              # CF Workers config for API
│   │
│   └── web/
│       ├── src/
│       │   ├── app/                    # Moved from src/app/
│       │   ├── auth.ts                 # Moved from src/auth.ts
│       │   ├── auth.config.ts          # Moved from src/auth.config.ts
│       │   ├── components/             # Moved from src/components/
│       │   ├── i18n/                   # Moved from src/i18n/
│       │   ├── lib/
│       │   │   └── utils.ts           # cn() utility (stays in web)
│       │   ├── middleware.ts           # Moved from src/middleware.ts
│       │   └── modules/               # Moved from src/modules/
│       ├── tests/
│       │   ├── setup.ts               # Moved from tests/setup.ts
│       │   ├── smoke.test.ts          # Moved from tests/smoke.test.ts
│       │   └── modules/
│       │       └── auth/
│       │           └── actions.test.ts # Moved from tests/modules/auth/actions.test.ts
│       ├── messages/                   # Moved from messages/
│       ├── public/                     # Moved from public/
│       ├── components.json
│       ├── next.config.ts
│       ├── postcss.config.mjs
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── wrangler.jsonc             # CF Pages config for web
│
├── drizzle/                           # Stays at root (migrations are project-wide)
├── drizzle.config.ts                  # Updated path to shared schema
├── biome.json                         # Replaces eslint.config.mjs
├── package.json                       # Bun workspace root
├── tsconfig.base.json                 # Shared TS config, packages extend this
└── .github/workflows/ci.yml          # Updated for monorepo
```

---

### Task 1: Create Bun Workspace Root

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Convert root package.json to workspace root**

Replace `package.json` with:

```json
{
  "name": "kuruma-rental",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter @kuruma/web dev",
    "dev:api": "bun run --filter @kuruma/api dev",
    "build": "bun run --filter '*' build",
    "test": "bun run --filter '*' test",
    "lint": "bunx biome check .",
    "lint:fix": "bunx biome check --write .",
    "format": "bunx biome format --write .",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "drizzle-kit": "^0.31.10",
    "typescript": "^5"
  },
  "trustedDependencies": [
    "sharp",
    "unrs-resolver"
  ]
}
```

- [ ] **Step 2: Create shared base tsconfig**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true
  },
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add package.json tsconfig.base.json
git commit -m "refactor: convert root to Bun workspace"
```

---

### Task 2: Create `packages/shared` — Schema and Validators

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Move: `src/db/schema.ts` → `packages/shared/src/db/schema.ts`
- Move: `src/db/index.ts` → `packages/shared/src/db/index.ts`
- Move: `src/lib/validations/auth.ts` → `packages/shared/src/validators/auth.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create shared package.json**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
mkdir -p packages/shared/src/db packages/shared/src/validators packages/shared/tests/validators
```

Create `packages/shared/package.json`:

```json
{
  "name": "@kuruma/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./db": "./src/db/index.ts",
    "./db/schema": "./src/db/schema.ts",
    "./validators/auth": "./src/validators/auth.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "postgres": "^3.4.8",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "next-auth": "^5.0.0-beta.30",
    "vitest": "^2"
  }
}
```

Note: `next-auth` is a devDependency because `schema.ts` imports `AdapterAccountType` from `next-auth/adapters` (type-only). It's not a runtime dependency of the shared package.

- [ ] **Step 2: Create shared tsconfig.json**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@kuruma/shared/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create shared vitest.config.ts**

Create `packages/shared/vitest.config.ts`:

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@kuruma/shared': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 4: Copy schema.ts to shared (preserve original for now — parallel change)**

Copy `src/db/schema.ts` to `packages/shared/src/db/schema.ts` (exact copy, no changes):

```typescript
import { pgEnum, pgTable, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

export const roleEnum = pgEnum('role', ['RENTER', 'STAFF', 'ADMIN'])

// Auth.js required fields + app profile fields
// Column names must be camelCase to match @auth/drizzle-adapter expectations
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique().notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  role: roleEnum('role').notNull().default('RENTER'),
  language: text('language').notNull().default('en'),
  country: text('country'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const accounts = pgTable('accounts', {
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccountType>().notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('providerAccountId').notNull(),
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
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

- [ ] **Step 5: Copy db/index.ts to shared**

Copy `src/db/index.ts` to `packages/shared/src/db/index.ts` (exact copy):

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

let db: ReturnType<typeof drizzle> | undefined

export function getDb(): ReturnType<typeof drizzle> {
  if (db) return db

  const url = process.env.DATABASE_URL

  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }

  const client = postgres(url, { prepare: false })
  db = drizzle(client, { schema })
  return db
}
```

- [ ] **Step 6: Copy validators/auth.ts to shared**

Copy `src/lib/validations/auth.ts` to `packages/shared/src/validators/auth.ts` (exact copy):

```typescript
import { z } from 'zod'

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required'),
  email: z
    .string()
    .email('Invalid email address')
    .transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters'),
})

export type RegisterInput = z.infer<typeof registerSchema>
```

- [ ] **Step 7: Create barrel export**

Create `packages/shared/src/index.ts`:

```typescript
export { getDb } from './db'
export * from './db/schema'
export { registerSchema, type RegisterInput } from './validators/auth'
```

- [ ] **Step 8: Write failing test — schema smoke test**

Create `packages/shared/tests/db/schema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { users, accounts, sessions, verificationTokens, roleEnum } from '../../src/db/schema'

describe('schema exports', () => {
  it('exports all table definitions', () => {
    expect(users).toBeDefined()
    expect(accounts).toBeDefined()
    expect(sessions).toBeDefined()
    expect(verificationTokens).toBeDefined()
  })

  it('users table has required columns', () => {
    const columnNames = Object.keys(users)
    expect(columnNames).toContain('id')
    expect(columnNames).toContain('email')
    expect(columnNames).toContain('role')
    expect(columnNames).toContain('language')
  })

  it('roleEnum contains expected values', () => {
    expect(roleEnum.enumValues).toEqual(['RENTER', 'STAFF', 'ADMIN'])
  })
})
```

- [ ] **Step 9: Move auth validator test to shared**

Copy `tests/lib/validations/auth.test.ts` to `packages/shared/tests/validators/auth.test.ts` with updated import path:

```typescript
import { describe, expect, it } from 'vitest'
import { registerSchema } from '../../src/validators/auth'

describe('registerSchema', () => {
  const validInput = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
  }

  it('accepts valid input', () => {
    const result = registerSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects empty email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: '' })
    expect(result.success).toBe(false)
  })

  it('rejects password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: '1234567' })
    expect(result.success).toBe(false)
  })

  it('accepts password of exactly 8 characters', () => {
    const result = registerSchema.safeParse({ ...validInput, password: '12345678' })
    expect(result.success).toBe(true)
  })

  it('trims name whitespace', () => {
    const result = registerSchema.safeParse({ ...validInput, name: '  Test User  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Test User')
    }
  })

  it('lowercases email', () => {
    const result = registerSchema.safeParse({ ...validInput, email: 'Test@Example.COM' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('test@example.com')
    }
  })
})
```

- [ ] **Step 10: Install dependencies and run shared tests**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun install
bun run --filter @kuruma/shared test
```

Expected: All 12 tests pass (3 schema + 9 validator tests).

- [ ] **Step 11: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add packages/shared/
git commit -m "refactor: create shared package with schema and validators"
```

---

### Task 3: Create `packages/web` — Move Next.js Frontend

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vitest.config.ts`
- Move: all `src/` contents → `packages/web/src/`
- Move: `messages/` → `packages/web/messages/`
- Move: `public/` → `packages/web/public/`
- Move: `next.config.ts` → `packages/web/next.config.ts`
- Move: `postcss.config.mjs` → `packages/web/postcss.config.mjs`
- Move: `components.json` → `packages/web/components.json`
- Move: `wrangler.jsonc` → `packages/web/wrangler.jsonc`
- Move: `tests/` → `packages/web/tests/`

- [ ] **Step 1: Create web package.json**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
mkdir -p packages/web
```

Create `packages/web/package.json`:

```json
{
  "name": "@kuruma/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "build:worker": "opennextjs-cloudflare",
    "preview": "opennextjs-cloudflare && wrangler dev",
    "deploy": "opennextjs-cloudflare && wrangler deploy",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@auth/drizzle-adapter": "^1.11.1",
    "@base-ui/react": "^1.3.0",
    "@kuruma/shared": "workspace:*",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.7.0",
    "next": "16.2.2",
    "next-auth": "^5.0.0-beta.30",
    "next-intl": "^4.9.0",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "shadcn": "^4.1.2",
    "tailwind-merge": "^3.5.0",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@opennextjs/cloudflare": "^1.18.0",
    "@tailwindcss/postcss": "^4",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "happy-dom": "^20.8.9",
    "tailwindcss": "^4",
    "vitest": "^2",
    "wrangler": "^4.80.0"
  }
}
```

Note: `@kuruma/shared` is a workspace dependency. Zod, drizzle-orm, postgres are NOT listed here — they're transitive from `@kuruma/shared`.

- [ ] **Step 2: Create web tsconfig.json**

Create `packages/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"],
      "@kuruma/shared": ["../shared/src"],
      "@kuruma/shared/*": ["../shared/src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create web vitest.config.ts**

Create `packages/web/vitest.config.ts`:

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})
```

- [ ] **Step 4: Move source files to web package**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split

# Move src/ contents
cp -r src/ packages/web/src/

# Move supporting directories
cp -r messages/ packages/web/messages/
cp -r public/ packages/web/public/
cp -r tests/ packages/web/tests/

# Move config files
cp next.config.ts packages/web/next.config.ts
cp postcss.config.mjs packages/web/postcss.config.mjs
cp components.json packages/web/components.json
cp wrangler.jsonc packages/web/wrangler.jsonc
```

- [ ] **Step 5: Update web imports to use @kuruma/shared**

Update `packages/web/src/auth.ts` — change db and schema imports:

```typescript
import NextAuth from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { getDb } from '@kuruma/shared/db'
import { users, accounts, sessions, verificationTokens } from '@kuruma/shared/db/schema'
import authConfig from './auth.config'

const db = getDb()

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
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

- [ ] **Step 6: Remove validator test from web (it lives in shared now)**

```bash
rm packages/web/tests/lib/validations/auth.test.ts
rmdir packages/web/tests/lib/validations packages/web/tests/lib 2>/dev/null
```

- [ ] **Step 7: Remove db/ and validations/ from web src (they live in shared now)**

```bash
rm -r packages/web/src/db
rm -r packages/web/src/lib/validations
```

- [ ] **Step 8: Install dependencies and run web tests**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun install
bun run --filter @kuruma/web test
```

Expected: 4 tests pass (1 smoke + 3 auth actions).

- [ ] **Step 9: Run shared tests too (regression check)**

```bash
bun run --filter @kuruma/shared test
```

Expected: 12 tests pass.

- [ ] **Step 10: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add packages/web/
git commit -m "refactor: create web package with Next.js frontend"
```

---

### Task 4: Create `packages/api` — Hono Skeleton

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/vitest.config.ts`
- Create: `packages/api/src/index.ts`
- Create: `packages/api/src/routes/health.ts`
- Create: `packages/api/tests/routes/health.test.ts`
- Create: `packages/api/wrangler.toml`

- [ ] **Step 1: Write the failing test — health check route**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
mkdir -p packages/api/src/routes packages/api/tests/routes
```

Create `packages/api/tests/routes/health.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import app from '../../src/index'

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Verify test fails**

(Test will fail because `packages/api/src/index.ts` doesn't exist yet.)

- [ ] **Step 3: Create API package.json**

Create `packages/api/package.json`:

```json
{
  "name": "@kuruma/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kuruma/shared": "workspace:*",
    "hono": "^4"
  },
  "devDependencies": {
    "vitest": "^2",
    "wrangler": "^4.80.0"
  }
}
```

- [ ] **Step 4: Create API tsconfig.json**

Create `packages/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "paths": {
      "@kuruma/shared/*": ["../shared/src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create API vitest.config.ts**

Create `packages/api/vitest.config.ts`:

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      '@kuruma/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})
```

- [ ] **Step 6: Create the health route**

Create `packages/api/src/routes/health.ts`:

```typescript
import { Hono } from 'hono'

const health = new Hono()

health.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

export default health
```

- [ ] **Step 7: Create the Hono app entry point**

Create `packages/api/src/index.ts`:

```typescript
import { Hono } from 'hono'
import health from './routes/health'

const app = new Hono()

app.route('/', health)

export default app
```

- [ ] **Step 8: Create wrangler.toml for API worker**

Create `packages/api/wrangler.toml`:

```toml
name = "kuruma-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
```

- [ ] **Step 9: Install dependencies and run API tests**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun install
bun run --filter @kuruma/api test
```

Expected: 1 test passes (health check returns 200 with `{ status: 'ok' }`).

- [ ] **Step 10: Run all tests across workspace**

```bash
bun run test
```

Expected: All tests pass across all three packages (12 shared + 4 web + 1 api = 17 tests).

- [ ] **Step 11: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add packages/api/
git commit -m "feat: create API package with Hono skeleton and health check"
```

---

### Task 5: Clean Up Old File Locations

**Files:**
- Delete: `src/` (original, now in `packages/web/src/`)
- Delete: `tests/` (original, now split between `packages/shared/tests/` and `packages/web/tests/`)
- Delete: `messages/` (original, now in `packages/web/messages/`)
- Delete: `public/` (original, now in `packages/web/public/`)
- Delete: `next.config.ts`, `postcss.config.mjs`, `components.json`, `wrangler.jsonc`, `vitest.config.ts`
- Delete: `eslint.config.mjs` (replaced by Biome)
- Modify: `drizzle.config.ts` (update schema path)
- Modify: `tsconfig.json` (becomes reference-only root config)

- [ ] **Step 1: Remove old source directories and files**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split

# Remove old source (now in packages/web/)
rm -rf src/
rm -rf tests/
rm -rf messages/
rm -rf public/

# Remove old configs (now in packages/web/ or replaced)
rm next.config.ts
rm postcss.config.mjs
rm components.json
rm wrangler.jsonc
rm vitest.config.ts
rm eslint.config.mjs
```

- [ ] **Step 2: Update root tsconfig.json to reference packages**

Replace `tsconfig.json` with:

```json
{
  "extends": "./tsconfig.base.json",
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/api" },
    { "path": "./packages/web" }
  ],
  "include": [],
  "exclude": ["node_modules", "packages"]
}
```

- [ ] **Step 3: Update drizzle.config.ts to point to shared schema**

Replace `drizzle.config.ts` with:

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './packages/shared/src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

- [ ] **Step 4: Run all tests to verify nothing broke**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun run test
```

Expected: 17 tests pass (12 shared + 4 web + 1 api).

- [ ] **Step 5: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add -A
git commit -m "refactor: remove old file locations, update root configs"
```

---

### Task 6: Set Up Biome (Replace ESLint + Prettier)

**Files:**
- Create: `biome.json`

- [ ] **Step 1: Create biome.json**

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "warn"
      },
      "style": {
        "noNonNullAssertion": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded"
    }
  },
  "files": {
    "ignore": [
      "node_modules",
      ".next",
      ".open-next",
      "drizzle",
      "bun.lock"
    ]
  }
}
```

- [ ] **Step 2: Install and run Biome**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun install
bunx biome check .
```

Review output. Fix any issues:

```bash
bunx biome check --write .
```

- [ ] **Step 3: Run all tests after formatting**

```bash
bun run test
```

Expected: 17 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add biome.json
git add -u  # stage any formatting changes
git commit -m "chore: add Biome, replace ESLint + Prettier"
```

---

### Task 7: Update CI for Monorepo

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update CI workflow**

Replace `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test-and-build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install --frozen-lockfile

      - name: Lint
        run: bun run lint

      - name: Test (all packages)
        run: bun run test

      - name: Build web
        run: bun run --filter @kuruma/web build
        env:
          AUTH_SECRET: ci-placeholder-secret-not-real
          DATABASE_URL: postgresql://placeholder:placeholder@localhost:5432/placeholder
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add .github/workflows/ci.yml
git commit -m "ci: update workflow for monorepo structure"
```

---

### Task 8: Update AGENTS.md and Documentation

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md with working directory guidance**

Replace `AGENTS.md` with:

```markdown
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Monorepo Architecture

This is a Bun workspace monorepo with three packages:

- `packages/api` — Hono REST API (deploys to CF Workers). All business logic lives here.
- `packages/web` — Next.js frontend (deploys to CF Pages). UI only, no direct DB access.
- `packages/shared` — Drizzle schema, Zod validators, shared types. No runtime deps on api or web.

**Key rules:**
- The web package NEVER imports from `packages/api` directly. It calls the Hono API via `hono/client` (typed HTTP client).
- The API is the single source of truth for all data operations.
- Schema and validators live in `@kuruma/shared` — import from there, not from local copies.
- DB imports use `@kuruma/shared/db` and `@kuruma/shared/db/schema`.
- Validator imports use `@kuruma/shared/validators/auth` (etc.).

## Commands

| Task | Command |
|------|---------|
| Run all tests | `bun run test` |
| Run one package's tests | `bun run --filter @kuruma/web test` |
| Dev server (web) | `bun run dev` |
| Dev server (API) | `bun run dev:api` |
| Lint | `bun run lint` |
| Format | `bun run format` |
| DB migrations | `bun run db:generate && bun run db:migrate` |
```

- [ ] **Step 2: Run final full test suite**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
bun run test
```

Expected: 17 tests pass across all packages.

- [ ] **Step 3: Commit**

```bash
cd /Users/jack/Dev/kuruma-rental-monorepo-split
git add AGENTS.md
git commit -m "docs: update AGENTS.md for monorepo structure and commands"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| Flat `src/` directory | `packages/shared/`, `packages/api/`, `packages/web/` |
| ESLint + Prettier | Biome |
| `src/db/schema.ts` | `packages/shared/src/db/schema.ts` |
| `src/db/index.ts` | `packages/shared/src/db/index.ts` |
| `src/lib/validations/auth.ts` | `packages/shared/src/validators/auth.ts` |
| Next.js API routes (planned) | Hono API on CF Workers |
| 13 tests in one suite | 17 tests across 3 packages |
| Single `package.json` | Bun workspace with 4 `package.json` files |
| Single `tsconfig.json` | Base config + 3 package configs |

## Refactoring Techniques Applied

| Technique (Fowler) | Where |
|--------------------|-------|
| **Parallel Change (Expand-Contract)** | Copy files to new location, verify, then remove old |
| **Move Function** | schema.ts, index.ts, auth.ts validators moved to shared |
| **Extract Module** | Shared package extracted from web's db/validators |
| **Rename** | `src/lib/validations/` → `packages/shared/src/validators/` (clearer name) |
