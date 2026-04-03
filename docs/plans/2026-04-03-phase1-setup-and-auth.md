# Phase 1: Project Setup + Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Kuruma Rental project from scratch and implement authentication with role-based access (renter, staff, admin).

**Architecture:** Next.js App Router with Supabase Auth for authentication (email/password + Google + Apple OAuth). Prisma ORM connects to Supabase Postgres for the User profile table. Middleware enforces role-based route protection. shadcn/ui provides the component library.

**Tech Stack:** Next.js 15+, Supabase (Auth + Postgres), Prisma, Tailwind CSS, shadcn/ui, Zod, next-intl, TypeScript (strict mode)

**Phases overview (this is Phase 1 of 4):**
1. **Project Setup + Auth** (this plan)
2. Vehicles (CRUD, photos, availability)
3. Booking (request flow, scheduling, calendar dashboard)
4. Messaging + Translation (DM threads, Google Cloud Translation)

---

## File Structure

```
kuruma-rental/
├── .env.local                          # Supabase + Google/Apple OAuth secrets
├── .env.example                        # Template with placeholder values
├── prisma/
│   └── schema.prisma                   # User model, enums
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx              # Root layout with next-intl provider
│   │   │   ├── page.tsx                # Public landing page
│   │   │   ├── (auth)/
│   │   │   │   ├── layout.tsx          # Centered card layout for auth pages
│   │   │   │   ├── login/page.tsx      # Login form
│   │   │   │   ├── register/page.tsx   # Register form
│   │   │   │   └── callback/page.tsx   # OAuth callback handler
│   │   │   ├── (renter)/
│   │   │   │   └── layout.tsx          # Protected layout — renter role
│   │   │   └── (business)/
│   │   │       └── layout.tsx          # Protected layout — staff/admin role
│   │   ├── api/
│   │   │   └── auth/
│   │   │       └── callback/route.ts   # Supabase OAuth callback API route
│   │   └── globals.css                 # Tailwind imports
│   ├── components/
│   │   └── ui/                         # shadcn/ui components (auto-generated)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts              # Browser Supabase client
│   │   │   ├── server.ts              # Server-side Supabase client
│   │   │   └── middleware.ts          # Supabase auth middleware helper
│   │   ├── prisma.ts                  # Prisma client singleton
│   │   └── validations/
│   │       └── auth.ts                # Zod schemas for login/register
│   ├── modules/
│   │   └── auth/
│   │       ├── actions.ts             # Server actions: login, register, logout
│   │       └── queries.ts            # getUserProfile, getUserRole
│   ├── middleware.ts                   # Next.js middleware: auth + i18n + role routing
│   └── i18n/
│       ├── routing.ts                 # Locale config
│       └── request.ts                # next-intl server config
├── messages/
│   ├── en.json                        # English UI strings
│   ├── ja.json                        # Japanese UI strings
│   └── zh.json                        # Chinese UI strings
├── tests/
│   ├── modules/
│   │   └── auth/
│   │       ├── actions.test.ts        # Auth server action tests
│   │       └── queries.test.ts        # Auth query tests
│   └── setup.ts                       # Test setup (mock Supabase, Prisma)
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

### Task 1: Scaffold Next.js Project

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `src/app/globals.css`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`

- [ ] **Step 1: Create the Next.js project**

```bash
cd /Users/jack/Dev/kuruma-rental
bunx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

Select defaults when prompted. Since the directory has existing files (docs/, .git), create-next-app may warn — proceed with the install.

- [ ] **Step 2: Verify the project runs**

```bash
cd /Users/jack/Dev/kuruma-rental
bun run dev
```

Expected: Dev server starts at http://localhost:3000, shows default Next.js page.

- [ ] **Step 3: Enable strict TypeScript**

Edit `tsconfig.json` — ensure these are set in `compilerOptions`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with TypeScript and Tailwind"
```

---

### Task 2: Install Core Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production dependencies**

```bash
cd /Users/jack/Dev/kuruma-rental
bun add @supabase/supabase-js @supabase/ssr prisma @prisma/client zod next-intl
```

- [ ] **Step 2: Install dev dependencies**

```bash
bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Initialize Prisma**

```bash
cd /Users/jack/Dev/kuruma-rental
bunx prisma init
```

This creates `prisma/schema.prisma` and updates `.env` with a `DATABASE_URL` placeholder.

- [ ] **Step 4: Initialize shadcn/ui**

```bash
cd /Users/jack/Dev/kuruma-rental
bunx shadcn@latest init
```

Select: New York style, Zinc color, CSS variables. This creates `components.json` and `src/components/ui/`.

- [ ] **Step 5: Add shadcn/ui components we'll need for auth**

```bash
bunx shadcn@latest add button input label card tabs
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add core dependencies — Supabase, Prisma, shadcn/ui, next-intl"
```

---

### Task 3: Configure Environment Variables

**Files:**
- Create: `.env.example`
- Modify: `.env.local` (do NOT commit this)
- Modify: `.gitignore`

- [ ] **Step 1: Create .env.example**

```bash
# .env.example
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Database (Supabase Postgres connection string)
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres

# Google Cloud Translation
GOOGLE_CLOUD_TRANSLATION_API_KEY=your-key

# OAuth (configured in Supabase dashboard)
# Google and Apple OAuth are configured in Supabase dashboard, not here
```

- [ ] **Step 2: Ensure .gitignore includes .env.local**

Verify `.gitignore` contains:

```
.env.local
.env
```

- [ ] **Step 3: Create .env.local with real values**

Copy `.env.example` to `.env.local` and fill in real Supabase credentials from https://supabase.com/dashboard (create a new project called "kuruma-rental" if not yet created).

- [ ] **Step 4: Commit**

```bash
git add .env.example .gitignore
git commit -m "feat: add environment variable template"
```

---

### Task 4: Prisma Schema — User Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the Prisma schema**

Replace the contents of `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  RENTER
  STAFF
  ADMIN
}

model User {
  id              String   @id @default(cuid())
  supabaseAuthId  String   @unique
  email           String   @unique
  name            String
  role            Role     @default(RENTER)
  language        String   @default("en")
  country         String?
  avatarUrl       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@map("users")
}
```

- [ ] **Step 2: Push schema to Supabase database**

```bash
cd /Users/jack/Dev/kuruma-rental
bunx prisma db push
```

Expected: Schema synced to Supabase Postgres. Output shows "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Generate Prisma client**

```bash
bunx prisma generate
```

Expected: Prisma Client generated.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add User model with role enum to Prisma schema"
```

---

### Task 5: Prisma Client Singleton

**Files:**
- Create: `src/lib/prisma.ts`

- [ ] **Step 1: Create the Prisma client singleton**

```typescript
// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/prisma.ts
git commit -m "feat: add Prisma client singleton"
```

---

### Task 6: Supabase Client Setup

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`

- [ ] **Step 1: Create browser client**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Create server client**

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Create middleware helper**

```typescript
// src/lib/supabase/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, supabaseResponse };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat: add Supabase client setup — browser, server, middleware"
```

---

### Task 7: next-intl Configuration

**Files:**
- Create: `src/i18n/routing.ts`
- Create: `src/i18n/request.ts`
- Create: `messages/en.json`
- Create: `messages/ja.json`
- Create: `messages/zh.json`
- Modify: `next.config.ts`

- [ ] **Step 1: Create i18n routing config**

```typescript
// src/i18n/routing.ts
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ja", "zh"],
  defaultLocale: "en",
});
```

- [ ] **Step 2: Create i18n request config**

```typescript
// src/i18n/request.ts
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !routing.locales.includes(locale as "en" | "ja" | "zh")) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

- [ ] **Step 3: Create message files**

`messages/en.json`:
```json
{
  "common": {
    "appName": "Kuruma Rental",
    "loading": "Loading...",
    "error": "Something went wrong",
    "save": "Save",
    "cancel": "Cancel",
    "back": "Back"
  },
  "nav": {
    "home": "Home",
    "vehicles": "Vehicles",
    "bookings": "Bookings",
    "messages": "Messages",
    "dashboard": "Dashboard",
    "login": "Log in",
    "register": "Sign up",
    "logout": "Log out"
  },
  "auth": {
    "loginTitle": "Log in to your account",
    "registerTitle": "Create an account",
    "email": "Email",
    "password": "Password",
    "name": "Full name",
    "loginButton": "Log in",
    "registerButton": "Sign up",
    "orContinueWith": "Or continue with",
    "google": "Google",
    "apple": "Apple",
    "noAccount": "Don't have an account?",
    "hasAccount": "Already have an account?",
    "signUpLink": "Sign up",
    "loginLink": "Log in"
  },
  "landing": {
    "hero": "Rent a car in Japan",
    "subtitle": "Browse our fleet and book your perfect ride in Osaka",
    "cta": "Browse vehicles"
  }
}
```

`messages/ja.json`:
```json
{
  "common": {
    "appName": "くるまレンタル",
    "loading": "読み込み中...",
    "error": "エラーが発生しました",
    "save": "保存",
    "cancel": "キャンセル",
    "back": "戻る"
  },
  "nav": {
    "home": "ホーム",
    "vehicles": "車両",
    "bookings": "予約",
    "messages": "メッセージ",
    "dashboard": "ダッシュボード",
    "login": "ログイン",
    "register": "新規登録",
    "logout": "ログアウト"
  },
  "auth": {
    "loginTitle": "アカウントにログイン",
    "registerTitle": "アカウントを作成",
    "email": "メールアドレス",
    "password": "パスワード",
    "name": "氏名",
    "loginButton": "ログイン",
    "registerButton": "新規登録",
    "orContinueWith": "または以下で続ける",
    "google": "Google",
    "apple": "Apple",
    "noAccount": "アカウントをお持ちでないですか？",
    "hasAccount": "すでにアカウントをお持ちですか？",
    "signUpLink": "新規登録",
    "loginLink": "ログイン"
  },
  "landing": {
    "hero": "大阪でレンタカー",
    "subtitle": "車両を閲覧して、ぴったりの一台を予約しましょう",
    "cta": "車両を見る"
  }
}
```

`messages/zh.json`:
```json
{
  "common": {
    "appName": "Kuruma租车",
    "loading": "加载中...",
    "error": "出现错误",
    "save": "保存",
    "cancel": "取消",
    "back": "返回"
  },
  "nav": {
    "home": "首页",
    "vehicles": "车辆",
    "bookings": "预约",
    "messages": "消息",
    "dashboard": "仪表盘",
    "login": "登录",
    "register": "注册",
    "logout": "退出"
  },
  "auth": {
    "loginTitle": "登录账户",
    "registerTitle": "创建账户",
    "email": "邮箱",
    "password": "密码",
    "name": "姓名",
    "loginButton": "登录",
    "registerButton": "注册",
    "orContinueWith": "或使用以下方式",
    "google": "Google",
    "apple": "Apple",
    "noAccount": "还没有账户？",
    "hasAccount": "已有账户？",
    "signUpLink": "注册",
    "loginLink": "登录"
  },
  "landing": {
    "hero": "在日本租车",
    "subtitle": "浏览我们的车队，在大阪预订您的理想座驾",
    "cta": "浏览车辆"
  }
}
```

- [ ] **Step 4: Update next.config.ts for next-intl**

```typescript
// next.config.ts
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig = {};

export default withNextIntl(nextConfig);
```

- [ ] **Step 5: Commit**

```bash
git add src/i18n/ messages/ next.config.ts
git commit -m "feat: configure next-intl with EN, JA, ZH locales"
```

---

### Task 8: Root Layout with next-intl

**Files:**
- Create: `src/app/[locale]/layout.tsx`
- Modify: `src/app/globals.css` (keep Tailwind imports only)

- [ ] **Step 1: Create the locale layout**

```typescript
// src/app/[locale]/layout.tsx
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata: Metadata = {
  title: "Kuruma Rental",
  description: "Rent a car in Japan",
};

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as "en" | "ja" | "zh")) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gray-50 antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Clean up globals.css**

Ensure `src/app/globals.css` contains only Tailwind directives (remove default Next.js styles):

```css
@import "tailwindcss";
```

(Exact content depends on Tailwind v4 / shadcn init output — keep what shadcn generated, remove Next.js defaults.)

- [ ] **Step 3: Commit**

```bash
git add src/app/
git commit -m "feat: add locale layout with next-intl provider"
```

---

### Task 9: Auth Validation Schemas

**Files:**
- Create: `src/lib/validations/auth.ts`
- Create: `tests/modules/auth/validations.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/modules/auth/validations.test.ts
import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/lib/validations/auth";

describe("loginSchema", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      email: "test@example.com",
      password: "securepass123",
    });
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "securepass123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects password shorter than 8 characters", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "short",
    });
    expect(result.success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("accepts valid registration data", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
      name: "Test User",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      email: "test@example.com",
      password: "securepass123",
      name: "Test User",
    });
  });

  it("rejects empty name", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from name", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
      name: "  Test User  ",
    });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Test User");
  });
});
```

- [ ] **Step 2: Configure vitest**

Create `vitest.config.ts` at project root:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Create `tests/setup.ts`:

```typescript
// tests/setup.ts
// Test setup — add global mocks here as needed
```

Add test script to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/jack/Dev/kuruma-rental
bun run test:run tests/modules/auth/validations.test.ts
```

Expected: FAIL — cannot find module `@/lib/validations/auth`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/lib/validations/auth.ts
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun run test:run tests/modules/auth/validations.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/ src/lib/validations/ package.json
git commit -m "feat: add auth validation schemas with tests"
```

---

### Task 10: Auth Server Actions

**Files:**
- Create: `src/modules/auth/actions.ts`
- Create: `src/modules/auth/queries.ts`

- [ ] **Step 1: Create auth queries**

```typescript
// src/modules/auth/queries.ts
import { prisma } from "@/lib/prisma";

export async function getUserBySupabaseId(supabaseAuthId: string) {
  return prisma.user.findUnique({
    where: { supabaseAuthId },
  });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
  });
}
```

- [ ] **Step 2: Create auth server actions**

```typescript
// src/modules/auth/actions.ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { loginSchema, registerSchema } from "@/lib/validations/auth";
import type { LoginInput, RegisterInput } from "@/lib/validations/auth";

export async function login(input: LoginInput) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid email or password" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}

export async function register(input: RegisterInput) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid registration data" };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (authError) {
    return { error: authError.message };
  }

  if (!authData.user) {
    return { error: "Registration failed" };
  }

  await prisma.user.create({
    data: {
      supabaseAuthId: authData.user.id,
      email: parsed.data.email,
      name: parsed.data.name,
      role: "RENTER",
    },
  });

  redirect("/");
}

export async function loginWithOAuth(provider: "google" | "apple") {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SUPABASE_URL ? "" : "http://localhost:3000"}/api/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.url) {
    redirect(data.url);
  }
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 3: Create OAuth callback route**

```typescript
// src/app/api/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Create user profile if first login
      const existingUser = await prisma.user.findUnique({
        where: { supabaseAuthId: data.user.id },
      });

      if (!existingUser) {
        await prisma.user.create({
          data: {
            supabaseAuthId: data.user.id,
            email: data.user.email ?? "",
            name: data.user.user_metadata?.full_name ?? data.user.email ?? "",
            role: "RENTER",
          },
        });
      }

      return NextResponse.redirect(`${origin}/en`);
    }
  }

  return NextResponse.redirect(`${origin}/en/login?error=auth`);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/auth/ src/app/api/auth/
git commit -m "feat: add auth server actions — login, register, OAuth, logout"
```

---

### Task 11: Next.js Middleware — Auth + i18n + Role Routing

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create the middleware**

```typescript
// src/middleware.ts
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { updateSession } from "@/lib/supabase/middleware";
import { routing } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";

const intlMiddleware = createIntlMiddleware(routing);

const publicPaths = ["/", "/vehicles", "/login", "/register", "/callback"];
const renterPaths = ["/bookings", "/messages"];
const businessPaths = ["/dashboard", "/customers"];

function isPublicPath(pathname: string): boolean {
  const pathWithoutLocale = pathname.replace(/^\/(en|ja|zh)/, "") || "/";
  return publicPaths.some(
    (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(`${p}/`)
  );
}

function isRenterPath(pathname: string): boolean {
  const pathWithoutLocale = pathname.replace(/^\/(en|ja|zh)/, "") || "/";
  return renterPaths.some((p) => pathWithoutLocale.startsWith(p));
}

function isBusinessPath(pathname: string): boolean {
  const pathWithoutLocale = pathname.replace(/^\/(en|ja|zh)/, "") || "/";
  return businessPaths.some((p) => pathWithoutLocale.startsWith(p));
}

export async function middleware(request: NextRequest) {
  // Run intl middleware first for locale handling
  const intlResponse = intlMiddleware(request);

  // Skip auth check for public paths and API routes
  if (isPublicPath(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/api")) {
    // Still refresh session for public paths
    const { supabaseResponse } = await updateSession(request);
    // Merge cookies from supabase into intl response
    for (const cookie of supabaseResponse.cookies.getAll()) {
      intlResponse.cookies.set(cookie.name, cookie.value);
    }
    return intlResponse;
  }

  const { user, supabaseResponse } = await updateSession(request);

  // Not logged in — redirect to login
  if (!user) {
    const locale = request.nextUrl.pathname.split("/")[1] ?? "en";
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  // Merge supabase cookies into intl response
  for (const cookie of supabaseResponse.cookies.getAll()) {
    intlResponse.cookies.set(cookie.name, cookie.value);
  }

  return intlResponse;
}

export const config = {
  matcher: ["/((?!_next|api/auth|.*\\..*).*)"],
};
```

Note: Role-based route protection (checking if a renter accesses business paths) will be handled in the route group layouts rather than middleware, since middleware runs on the edge and can't easily query Prisma. The middleware handles auth session refresh and login redirects.

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add middleware for auth session refresh and i18n routing"
```

---

### Task 12: Auth Pages — Login

**Files:**
- Create: `src/app/[locale]/(auth)/layout.tsx`
- Create: `src/app/[locale]/(auth)/login/page.tsx`

- [ ] **Step 1: Create auth layout**

```typescript
// src/app/[locale]/(auth)/layout.tsx
interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create login page**

```typescript
// src/app/[locale]/(auth)/login/page.tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { login, loginWithOAuth } from "@/modules/auth/actions";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await login({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    });

    if (result?.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  async function handleOAuth(provider: "google" | "apple") {
    setError(null);
    const result = await loginWithOAuth(provider);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("loginTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input id="password" name="password" type="password" required />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "..." : t("loginButton")}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("orContinueWith")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => handleOAuth("google")}>
            {t("google")}
          </Button>
          <Button variant="outline" onClick={() => handleOAuth("apple")}>
            {t("apple")}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <a href="/register" className="text-primary underline">
            {t("signUpLink")}
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/
git commit -m "feat: add login page with email + OAuth"
```

---

### Task 13: Auth Pages — Register

**Files:**
- Create: `src/app/[locale]/(auth)/register/page.tsx`

- [ ] **Step 1: Create register page**

```typescript
// src/app/[locale]/(auth)/register/page.tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { register, loginWithOAuth } from "@/modules/auth/actions";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const result = await register({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      name: formData.get("name") as string,
    });

    if (result?.error) {
      setError(result.error);
    }
    setIsLoading(false);
  }

  async function handleOAuth(provider: "google" | "apple") {
    setError(null);
    const result = await loginWithOAuth(provider);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("registerTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("name")}</Label>
            <Input id="name" name="name" type="text" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "..." : t("registerButton")}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              {t("orContinueWith")}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => handleOAuth("google")}>
            {t("google")}
          </Button>
          <Button variant="outline" onClick={() => handleOAuth("apple")}>
            {t("apple")}
          </Button>
        </div>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          {t("hasAccount")}{" "}
          <a href="/login" className="text-primary underline">
            {t("loginLink")}
          </a>
        </p>
      </CardFooter>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/register/
git commit -m "feat: add register page with email + OAuth"
```

---

### Task 14: OAuth Callback Page

**Files:**
- Create: `src/app/[locale]/(auth)/callback/page.tsx`

- [ ] **Step 1: Create the callback page**

This page shows a loading state while the OAuth callback API route processes:

```typescript
// src/app/[locale]/(auth)/callback/page.tsx
"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function AuthCallbackPage() {
  const t = useTranslations("common");

  useEffect(() => {
    // The actual OAuth exchange happens in /api/auth/callback
    // This page is just a loading state shown during the redirect
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\[locale\]/\(auth\)/callback/
git commit -m "feat: add OAuth callback loading page"
```

---

### Task 15: Protected Route Group Layouts

**Files:**
- Create: `src/app/[locale]/(renter)/layout.tsx`
- Create: `src/app/[locale]/(business)/layout.tsx`

- [ ] **Step 1: Create renter layout with role check**

```typescript
// src/app/[locale]/(renter)/layout.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBySupabaseId } from "@/modules/auth/queries";

interface RenterLayoutProps {
  children: React.ReactNode;
}

export default async function RenterLayout({ children }: RenterLayoutProps) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const user = await getUserBySupabaseId(authUser.id);

  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Create business layout with role check**

```typescript
// src/app/[locale]/(business)/layout.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBySupabaseId } from "@/modules/auth/queries";

interface BusinessLayoutProps {
  children: React.ReactNode;
}

export default async function BusinessLayout({ children }: BusinessLayoutProps) {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login");
  }

  const user = await getUserBySupabaseId(authUser.id);

  if (!user || (user.role !== "STAFF" && user.role !== "ADMIN")) {
    redirect("/");
  }

  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(renter\)/ src/app/\[locale\]/\(business\)/
git commit -m "feat: add role-protected route group layouts"
```

---

### Task 16: Landing Page

**Files:**
- Create: `src/app/[locale]/page.tsx`

- [ ] **Step 1: Create a simple landing page**

```typescript
// src/app/[locale]/page.tsx
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const t = useTranslations("landing");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl mb-4">
        {t("hero")}
      </h1>
      <p className="text-lg text-muted-foreground mb-8 max-w-md">
        {t("subtitle")}
      </p>
      <a href="/vehicles">
        <Button size="lg">{t("cta")}</Button>
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

```bash
cd /Users/jack/Dev/kuruma-rental
bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/page.tsx
git commit -m "feat: add landing page"
```

---

### Task 17: Smoke Test — Full Auth Flow

**Files:** None (manual verification)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/jack/Dev/kuruma-rental
bun run dev
```

- [ ] **Step 2: Verify pages load**

Open in browser and verify:
- `http://localhost:3000` — redirects to `/en`, shows landing page
- `http://localhost:3000/en/login` — shows login form with Google/Apple buttons
- `http://localhost:3000/en/register` — shows register form
- `http://localhost:3000/ja` — shows Japanese landing page
- `http://localhost:3000/zh` — shows Chinese landing page

- [ ] **Step 3: Test email registration**

1. Go to `/en/register`
2. Enter name, email, password (8+ chars)
3. Submit — should redirect to home
4. Check Supabase dashboard — user should appear in Auth and in the `users` table

- [ ] **Step 4: Test login**

1. Go to `/en/login`
2. Enter same credentials
3. Submit — should redirect to home

- [ ] **Step 5: Verify role protection**

1. Navigate to a business route (once placeholder pages exist)
2. As a RENTER user, should redirect to home
3. In Supabase, manually change user role to ADMIN
4. Refresh — business routes should now be accessible

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 — project setup and auth"
```

---

## Plan Summary

| Task | Description | Commits |
|------|-------------|---------|
| 1 | Scaffold Next.js project | 1 |
| 2 | Install core dependencies | 1 |
| 3 | Configure environment variables | 1 |
| 4 | Prisma schema — User model | 1 |
| 5 | Prisma client singleton | 1 |
| 6 | Supabase client setup | 1 |
| 7 | next-intl configuration | 1 |
| 8 | Root layout with next-intl | 1 |
| 9 | Auth validation schemas (TDD) | 1 |
| 10 | Auth server actions | 1 |
| 11 | Middleware — auth + i18n | 1 |
| 12 | Login page | 1 |
| 13 | Register page | 1 |
| 14 | OAuth callback page | 1 |
| 15 | Protected route group layouts | 1 |
| 16 | Landing page + build verify | 1 |
| 17 | Smoke test — full auth flow | 1 |

**Next plans (not yet written):**
- Phase 2: Vehicles (CRUD, photos, availability)
- Phase 3: Booking (request flow, scheduling, calendar dashboard)
- Phase 4: Messaging + Translation (DM threads, Google Cloud Translation)
