# Add-on Description Machine-Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an operator saves an add-on `descriptionOverride`, machine-translate the authored locale into the other `SUPPORTED_LOCALES` so every renter reads the description in their own language.

**Architecture:** A new best-effort `DescriptionTranslator` collaborator wraps the existing DI `TranslationProvider`. `AddOnService` gains it as a REQUIRED constructor param and, for SELF-AUTHORED rows only, fills the missing locales at author-time (persisted, not read-time). Picked rows and source-agnostic callers store their bag verbatim. Failures degrade to source-only and never fail the save.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Hono, Vitest, `@sentry/cloudflare`, Vite + TanStack Router + use-intl (web).

**Source of truth:** `docs/plans/2026-07-09-addon-description-mt-design.md` (architect-reviewed; HIGH-1, HIGH-2, MEDIUM-3/4/5, LOW-6, NIT-7 all folded).

---

## File Structure

**Create:**
- `packages/api/src/services/description-translation.ts` — the `DescriptionTranslator` port + `MachineDescriptionTranslator` impl (wraps `TranslationProvider`, best-effort parallel fill, MEDIUM-4 observability).
- `packages/api/tests/services/description-translation.test.ts` — translator unit tests.
- `packages/api/tests/helpers/fake-translator.ts` — test-only fakes (`fakeDescriptionTranslator`, `sourceOnlyTranslator`) passed by every `new AddOnService(...)` test site (MEDIUM-3).
- `packages/api/tests/routes/add-on-description-mt-wired.test.ts` — boots the composed app and proves the real translator MT-fills end-to-end (MEDIUM-3 wiring guard).
- `packages/web/src/vite/operator-add-ons/api.test.ts` — asserts writes carry `&locale=`.

**Modify:**
- `packages/api/src/services/add-on.ts` — required `descriptionTranslator` param (3rd, before the defaulted flag); resolve the persisted bag in `create` and `update`; add `resolveDescriptionOverride` + module `isDescriptionComplete`.
- `packages/api/src/index.ts:498` — build `MachineDescriptionTranslator` over the existing `translationProvider` (index.ts:214) and inject (MEDIUM-5).
- `packages/api/tests/services/add-on.test.ts`, `packages/api/tests/services/add-on-template.test.ts`, `packages/api/tests/routes/add-ons.test.ts`, `packages/api/tests/integration/add-on-repo.test.ts` — pass a fake translator to every `new AddOnService(...)`.
- `packages/web/src/vite/operator-add-ons/api.ts` — thread `locale` into `createAddOn`/`updateAddOn`, append `?locale=`/`&locale=`.
- `packages/web/src/vite/operator-add-ons/AddAddOnDialog.tsx`, `EditAddOnDialog.tsx` — pass the already-computed `locale` to the write calls.

**No migration. No validator change. No read-DTO / wire-fence change** — `descriptionOverride` already exists and is already resolved.

---

## Task 1: `DescriptionTranslator` port + `MachineDescriptionTranslator`

Self-contained; no `AddOnService` coupling yet. Best-effort parallel fill: source verbatim, each other locale via the provider; a rejected locale is dropped (reader falls back) but logged (MEDIUM-4). Parallelism bounds wall-clock to the provider's own ~6s-per-locale cap (LOW-6) — no extra timer, which would only drop locales the provider might still return.

**Files:**
- Create: `packages/api/src/services/description-translation.ts`
- Test: `packages/api/tests/services/description-translation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/tests/services/description-translation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { MachineDescriptionTranslator } from '../../src/services/description-translation'
import type { TranslationProvider } from '../../src/services/translation-provider'

// Deterministic fake: `<target><-<text>`, echoing the source code back so a
// mutation to the wiring (wrong source/target) changes the asserted value.
const echoProvider: TranslationProvider = {
  translate: async (text, source, target) => ({
    translatedText: `${target}<-${text}`,
    detectedLanguage: source ?? target,
  }),
}

describe('MachineDescriptionTranslator.fill', () => {
  it('stores the source verbatim and fills every other locale via the provider', async () => {
    const translator = new MachineDescriptionTranslator(echoProvider)
    const bag = await translator.fill('ja', 'こんにちは')
    expect(bag).toEqual({ ja: 'こんにちは', en: 'en<-こんにちは', zh: 'zh<-こんにちは' })
  })

  it('drops (but logs) a locale whose provider call throws; source survives', async () => {
    const failingZh: TranslationProvider = {
      translate: async (text, source, target) => {
        if (target === 'zh') throw new Error('provider down')
        return { translatedText: `${target}<-${text}`, detectedLanguage: source ?? target }
      },
    }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const translator = new MachineDescriptionTranslator(failingZh)
    const bag = await translator.fill('ja', 'X')
    expect(bag).toEqual({ ja: 'X', en: 'en<-X' })
    expect(errSpy).toHaveBeenCalledOnce()
    errSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter @kuruma/api test description-translation`
Expected: FAIL — cannot find module `../../src/services/description-translation`.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/services/description-translation.ts`:

```ts
import * as Sentry from '@sentry/cloudflare'
import { type Locale, SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import type { TranslationProvider } from './translation-provider'

/**
 * Fills an add-on description override so every locale carries text. Model B
 * (#1318): the operator authors one locale; this re-derives the others by MT on
 * every save. Best-effort — a locale whose provider call fails is omitted and the
 * reader falls back via resolveOwnDescription; it is never fatal to the save.
 */
export interface DescriptionTranslator {
  fill(sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride>
}

export class MachineDescriptionTranslator implements DescriptionTranslator {
  constructor(private readonly provider: TranslationProvider) {}

  async fill(sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> {
    // Non-source locales in parallel: total wall-clock ≈ one provider call
    // (TIMEOUT_MS × MAX_ATTEMPTS ≈ 6s), not the sum (LOW-6). allSettled so one
    // rejection never sinks the others.
    const targets = SUPPORTED_LOCALES.filter((locale) => locale !== sourceLocale)
    const settled = await Promise.allSettled(
      targets.map((target) => this.provider.translate(sourceText, sourceLocale, target)),
    )

    return settled.reduce<LocalizedTextOverride>(
      (bag, result, index) => {
        const target = targets[index]
        if (!target) return bag
        if (result.status === 'fulfilled') {
          return { ...bag, [target]: result.value.translatedText }
        }
        // MEDIUM-4: never a fully-silent drop. Request obs only reports 5xx/slow,
        // so a GOOGLE_TRANSLATE_API_KEY drift would degrade every save with no
        // signal. Parity with message-translation.ts, plus Sentry.
        console.error('Add-on description translation failed', {
          sourceLocale,
          target,
          err: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
        Sentry.captureException(result.reason)
        return bag
      },
      { [sourceLocale]: sourceText },
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter @kuruma/api test description-translation`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/description-translation.ts packages/api/tests/services/description-translation.test.ts
git commit -m "feat(#1318): DescriptionTranslator port + best-effort MT fill"
```

---

## Task 2: Thread the required translator through `AddOnService.create`

Introduces the REQUIRED constructor param (3rd, before the defaulted `isSharedCatalogEnabled` so the optional param stays last), rewires every `new AddOnService(...)` site, and implements the create-path fill. Biome's `noUnusedPrivateClassMembers` means the param must be used in the same commit — the create-path logic is that first use.

**Files:**
- Create: `packages/api/tests/helpers/fake-translator.ts`
- Modify: `packages/api/src/services/add-on.ts`
- Modify (rewire sites): `packages/api/tests/services/add-on.test.ts`, `packages/api/tests/services/add-on-template.test.ts`, `packages/api/tests/routes/add-ons.test.ts`, `packages/api/tests/integration/add-on-repo.test.ts`, `packages/api/src/index.ts`
- Test: `packages/api/tests/services/add-on.test.ts` (new create-MT cases)

- [ ] **Step 1: Create the test fakes**

Create `packages/api/tests/helpers/fake-translator.ts`:

```ts
import { type Locale, SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'
import type { DescriptionTranslator } from '../../src/services/description-translation'

/**
 * Deterministic test double: source verbatim, every other locale `<locale>:<text>`.
 * Mutation-resistant — tests assert the exact filled value. Spy with
 * `vi.spyOn(translator, 'fill')` to assert zero-call (skip / picked / verbatim) paths.
 */
export function fakeDescriptionTranslator(): DescriptionTranslator {
  return {
    fill: async (sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> =>
      SUPPORTED_LOCALES.reduce<LocalizedTextOverride>(
        (bag, locale) => ({
          ...bag,
          [locale]: locale === sourceLocale ? sourceText : `${locale}:${sourceText}`,
        }),
        {},
      ),
  }
}

/** Simulates a total provider outage: fill returns only the source slot. */
export function sourceOnlyTranslator(): DescriptionTranslator {
  return {
    fill: async (sourceLocale: Locale, sourceText: string): Promise<LocalizedTextOverride> => ({
      [sourceLocale]: sourceText,
    }),
  }
}
```

- [ ] **Step 2: Add the required constructor param + create-path fill**

In `packages/api/src/services/add-on.ts`:

Add imports near the top (after the existing `Locale` import line):

```ts
import { type Locale, SUPPORTED_LOCALES } from '@kuruma/shared/i18n/locales'
```

(Replace the existing `import type { Locale } from '@kuruma/shared/i18n/locales'` line with the above — `SUPPORTED_LOCALES` is now needed. Keep it a value import.)

Add after the `import ... from './add-on-resolve'` line:

```ts
import type { DescriptionTranslator } from './description-translation'
```

Add this module-level helper just below the `const NOT_FOUND_MESSAGE` block:

```ts
// A description bag is COMPLETE when every supported locale carries text. Used to
// skip re-translation on an unchanged self-authored save (and to retry when a prior
// save dropped a locale). noUncheckedIndexedAccess: bag[locale] is string | undefined.
function isDescriptionComplete(bag: LocalizedTextOverride): boolean {
  return SUPPORTED_LOCALES.every((locale) => Boolean(bag[locale]))
}
```

Change the constructor to insert `descriptionTranslator` as the 3rd param:

```ts
  constructor(
    private readonly repo: AddOnRepository,
    private readonly templateRepo: AddOnTemplateRepository,
    // #1318: REQUIRED (no default). A no-op default would fail to degraded output
    // (source-only, no error) on a forgotten wiring; a required param fails at
    // compile time instead. Wired in index.ts; tests pass a fake explicitly.
    private readonly descriptionTranslator: DescriptionTranslator,
    private readonly isSharedCatalogEnabled: () => Promise<boolean> = () => Promise.resolve(true),
  ) {}
```

Add this private method (place it just above `async create`):

```ts
  /**
   * Model B fill (#1318). MT owns the non-source locales of a SELF-AUTHORED
   * description, refreshed on every save. Returns the bag to persist.
   *
   * - Picked rows (HIGH-1): verbatim — their other locales resolve through the
   *   curated template description; MT would shadow human text with machine text.
   * - No source slot (HIGH-2): verbatim — `?locale=` defaults to `en` and the API
   *   is source-agnostic (Trip.com), so a ja-only bag sent without `?locale=ja`
   *   must not be coerced to null / re-based.
   * - Unchanged source + complete stored bag (update): keep the stored bag, no MT.
   */
  private async resolveDescriptionOverride(
    isSelfAuthored: boolean,
    locale: Locale,
    incoming: LocalizedTextOverride | null,
    existingBag: LocalizedTextOverride | null,
  ): Promise<LocalizedTextOverride | null> {
    if (!isSelfAuthored) return incoming
    if (incoming === null) return null
    const sourceText = incoming[locale]
    if (!sourceText) return incoming
    if (existingBag && existingBag[locale] === sourceText && isDescriptionComplete(existingBag)) {
      return existingBag
    }
    return this.descriptionTranslator.fill(locale, sourceText)
  }
```

Change `create` to resolve the bag once before dispatching:

```ts
  async create(_ctx: CallerContext, data: AddOnCreate, locale: Locale): Promise<AddOnResult> {
    const descriptionOverride = await this.resolveDescriptionOverride(
      data.nameI18n != null,
      locale,
      data.descriptionOverride,
      null,
    )
    const resolved: AddOnCreate = { ...data, descriptionOverride }
    if (data.nameI18n) return this.createSelfAuthored(resolved, data.nameI18n, locale)
    if (data.templateId) {
      if (!(await this.isSharedCatalogEnabled())) {
        return { ok: false, error: CATALOG_DISABLED_MESSAGE, status: 422 }
      }
      return this.createFromTemplate(resolved, data.templateId, locale)
    }
    return { ok: false, error: MISSING_IDENTITY_MESSAGE, status: 400 }
  }
```

(The `createFromTemplate` / `createSelfAuthored` bodies are unchanged — they already read `data.descriptionOverride`, now the resolved bag.)

- [ ] **Step 3: Rewire every `new AddOnService(...)` site (compile-green)**

Insert `fakeDescriptionTranslator()` as the 3rd arg (before any flag thunk). Add the import `import { fakeDescriptionTranslator } from '../helpers/fake-translator'` (adjust relative depth: `../helpers/...` from `tests/services` and `tests/routes`, `../helpers/...` from `tests/integration`) to each test file.

`packages/api/tests/services/add-on.test.ts` — 5 sites:
- L55: `service = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator())`
- L113-116: `const svc = new AddOnService(new InMemoryAddOnRepository(), new InMemoryAddOnTemplateRepository(store), fakeDescriptionTranslator())`
- L155-157: `const off = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator(), () => Promise.resolve(false))`
- L168-170: same shape as L155.
- L362: `service = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator())`

`packages/api/tests/services/add-on-template.test.ts` L113: `addOnService = new AddOnService(addOnRepo, templateRepo, fakeDescriptionTranslator())`

`packages/api/tests/routes/add-ons.test.ts`:
- L29: `new AddOnService(repo, new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator())`
- L62: `new AddOnService(new InMemoryAddOnRepository(), new InMemoryAddOnTemplateRepository(), fakeDescriptionTranslator())`

`packages/api/tests/integration/add-on-repo.test.ts`:
- L144: `const service = new AddOnService(repo, new DrizzleAddOnTemplateRepository(db), fakeDescriptionTranslator())`
- L194: same shape.

`packages/api/src/index.ts` — build the real translator over the existing provider and inject. After line 214 (`const translationProvider = createTranslationProvider()`) it already exists; at L498 change to:

```ts
  const addOnService = new AddOnService(
    addOnRepo,
    addOnTemplateRepo,
    new MachineDescriptionTranslator(translationProvider),
    isSharedCatalogEnabled,
  )
```

Add the import to `index.ts` (near the other service imports):

```ts
import { MachineDescriptionTranslator } from './services/description-translation'
```

- [ ] **Step 4: Write the failing create-MT tests**

Append to `packages/api/tests/services/add-on.test.ts` inside the `describe('create', ...)` block (the top-level `import { fakeDescriptionTranslator } from '../helpers/fake-translator'` is already added in Step 3; add `sourceOnlyTranslator` to that import if needed later):

```ts
    it('fills en/zh from a ja-authored self-authored description (Model B)', async () => {
      const result = await service.create(
        ctxFor(opA),
        {
          operatorId: opA,
          nameI18n: { en: 'GPS unit' },
          descriptionOverride: { ja: 'ポータブルGPS' },
          priceJpy: 1500,
        },
        'ja',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.descriptionOverride).toEqual({
          ja: 'ポータブルGPS',
          en: 'en:ポータブルGPS',
          zh: 'zh:ポータブルGPS',
        })
      }
    })

    it('stores a PICKED row description VERBATIM — no MT (HIGH-1)', async () => {
      const translator = fakeDescriptionTranslator()
      const fillSpy = vi.spyOn(translator, 'fill')
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), translator)
      const result = await svc.create(
        ctxFor(opA),
        { operatorId: opA, templateId: CHILD_SEAT, descriptionOverride: { en: 'My note' }, priceJpy: 1500 },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.descriptionOverride).toEqual({ en: 'My note' })
      expect(fillSpy).not.toHaveBeenCalled()
    })

    it('stores a self-authored bag VERBATIM when the ?locale slot is absent (HIGH-2)', async () => {
      const translator = fakeDescriptionTranslator()
      const fillSpy = vi.spyOn(translator, 'fill')
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), translator)
      // ja-only bag, but ?locale defaults to en -> sourceText = bag.en = undefined.
      const result = await svc.create(
        ctxFor(opA),
        { operatorId: opA, nameI18n: { en: 'GPS' }, descriptionOverride: { ja: '日本語のみ' }, priceJpy: 1500 },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.descriptionOverride).toEqual({ ja: '日本語のみ' })
      expect(fillSpy).not.toHaveBeenCalled()
    })
```

- [ ] **Step 5: Run tests to verify create-MT fails, then rewiring passes the rest**

Run: `bun run --filter @kuruma/api test add-on.test`
Expected: the three new create tests were RED before Step 2's `create` change; after Step 2 they PASS. Run the whole file now — all green. If the first MT test was written before the `create` edit, confirm RED first: temporarily assert `.toEqual({ ja: 'ポータブルGPS' })` fails against the filled bag.

- [ ] **Step 6: Verify typecheck + lint across the package**

Run: `bun run --filter @kuruma/api test add-on && bunx tsc --noEmit -p packages/api`
Expected: PASS, no type errors (all `new AddOnService` sites carry the translator).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/add-on.ts packages/api/src/index.ts \
  packages/api/tests/helpers/fake-translator.ts packages/api/tests/services/add-on.test.ts \
  packages/api/tests/services/add-on-template.test.ts packages/api/tests/routes/add-ons.test.ts \
  packages/api/tests/integration/add-on-repo.test.ts
git commit -m "feat(#1318): MT-fill self-authored add-on descriptions on create"
```

---

## Task 3: `AddOnService.update` MT (fill, skip-on-unchanged, verbatim, failure-safe)

**Files:**
- Modify: `packages/api/src/services/add-on.ts` (`update`)
- Test: `packages/api/tests/services/add-on.test.ts` (new update cases)

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/tests/services/add-on.test.ts` inside `describe('update', ...)`. Add `sourceOnlyTranslator` to the fake-translator import.

```ts
    it('re-fills en/zh when a self-authored description changes (Model B)', async () => {
      const created = await service.create(
        ctxFor(opA),
        { operatorId: opA, nameI18n: { en: 'GPS' }, descriptionOverride: null, priceJpy: 1500 },
        'en',
      )
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { descriptionOverride: { en: 'New copy' } },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.descriptionOverride).toEqual({
          en: 'New copy',
          ja: 'ja:New copy',
          zh: 'zh:New copy',
        })
      }
    })

    it('does NOT re-translate when the source is unchanged and the bag is complete', async () => {
      const translator = fakeDescriptionTranslator()
      const fillSpy = vi.spyOn(translator, 'fill')
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), translator)
      const created = await svc.create(
        ctxFor(opA),
        { operatorId: opA, nameI18n: { en: 'GPS' }, descriptionOverride: { en: 'Copy' }, priceJpy: 1500 },
        'en',
      )
      if (!created.ok) throw new Error('seed failed')
      fillSpy.mockClear() // ignore the create-time fill
      // The web client re-sends the full merged bag; source slot unchanged.
      const result = await svc.update(
        ctxFor(opA),
        created.option.id,
        { descriptionOverride: { en: 'Copy', ja: 'ja:Copy', zh: 'zh:Copy' } },
        'en',
      )
      expect(fillSpy).not.toHaveBeenCalled()
      if (result.ok) {
        expect(result.option.descriptionOverride).toEqual({ en: 'Copy', ja: 'ja:Copy', zh: 'zh:Copy' })
      }
    })

    it('does NOT translate on a price-only update (descriptionOverride untouched)', async () => {
      const translator = fakeDescriptionTranslator()
      const fillSpy = vi.spyOn(translator, 'fill')
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), translator)
      const created = await svc.create(
        ctxFor(opA),
        { operatorId: opA, nameI18n: { en: 'GPS' }, descriptionOverride: { en: 'Copy' }, priceJpy: 1500 },
        'en',
      )
      if (!created.ok) throw new Error('seed failed')
      fillSpy.mockClear()
      await svc.update(ctxFor(opA), created.option.id, { priceJpy: 3000 }, 'en')
      expect(fillSpy).not.toHaveBeenCalled()
    })

    it('persists the source slot and returns ok when every translation fails', async () => {
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), sourceOnlyTranslator())
      const created = await svc.create(
        ctxFor(opA),
        { operatorId: opA, nameI18n: { en: 'GPS' }, descriptionOverride: null, priceJpy: 1500 },
        'en',
      )
      if (!created.ok) throw new Error('seed failed')
      const result = await svc.update(
        ctxFor(opA),
        created.option.id,
        { descriptionOverride: { en: 'Only English survives' } },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.descriptionOverride).toEqual({ en: 'Only English survives' })
    })

    it('stores a PICKED row description update VERBATIM — no MT (HIGH-1)', async () => {
      const translator = fakeDescriptionTranslator()
      const fillSpy = vi.spyOn(translator, 'fill')
      const svc = new AddOnService(repo, new InMemoryAddOnTemplateRepository(), translator)
      const created = await svc.create(ctxFor(opA), createInput(opA, CHILD_SEAT), 'en')
      if (!created.ok) throw new Error('seed failed')
      fillSpy.mockClear()
      const result = await svc.update(
        ctxFor(opA),
        created.option.id,
        { descriptionOverride: { en: 'Picked note' } },
        'en',
      )
      expect(fillSpy).not.toHaveBeenCalled()
      if (result.ok) expect(result.option.descriptionOverride).toEqual({ en: 'Picked note' })
    })
```

- [ ] **Step 2: Run to verify the fill/verbatim tests fail**

Run: `bun run --filter @kuruma/api test add-on.test`
Expected: FAIL — `update` currently stores `descriptionOverride` verbatim, so the "re-fills en/zh" test fails (bag has only `en`). The verbatim/skip tests may already pass; the fill test must be RED.

- [ ] **Step 3: Implement the update-path resolve**

In `packages/api/src/services/add-on.ts`, in `update`, replace the `const fields: AddOnUpdate & { name?: string } = { ...data }` line and add the description resolve BEFORE the name re-seal block:

```ts
    const fields: AddOnUpdate & { name?: string } = { ...data }

    // #1318: MT-fill on a self-authored description change. `undefined` means the
    // field is untouched — leave the stored bag alone (and never translate on a
    // price-only edit). A picked row / cleared bag / absent source slot stores
    // verbatim (see resolveDescriptionOverride).
    if (data.descriptionOverride !== undefined) {
      fields.descriptionOverride = await this.resolveDescriptionOverride(
        existing.templateId === null,
        locale,
        data.descriptionOverride,
        existing.descriptionOverride,
      )
    }
```

(The subsequent `if (data.nameI18n) { ... }` name re-seal block and the `try { repo.update(ctx, id, fields) ... }` are unchanged.)

- [ ] **Step 4: Run to verify all update tests pass**

Run: `bun run --filter @kuruma/api test add-on.test`
Expected: PASS (all create + update cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/add-on.ts packages/api/tests/services/add-on.test.ts
git commit -m "feat(#1318): MT-fill self-authored descriptions on update, skip-on-unchanged"
```

---

## Task 4: Wiring guard — real translator MT-fills through the composed app (MEDIUM-3)

Boots the real `createApp` (no `GOOGLE_TRANSLATE_API_KEY` → dev stub returns `[<locale>] <text>`) and proves the create path actually MT-fills end-to-end. Mirrors `shared-catalog-killswitch-wired.test.ts`.

**Files:**
- Create: `packages/api/tests/routes/add-on-description-mt-wired.test.ts`

- [ ] **Step 1: Write the guard test**

```ts
import { seedId } from '@kuruma/shared/db/seed-id'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// #1318 MEDIUM-3: the service unit tests inject a fake translator, so they cannot
// catch a composition-root regression (a no-op translator wired by mistake, or the
// create path never invoking it). This boots the REAL app — no API key, so the dev
// stub fills `[<locale>] <text>` — and asserts a self-authored create is MT-filled.
describe('add-on description MT is wired into the composed app (#1318)', () => {
  it('fills ja/zh for a self-authored description via the real translator', async () => {
    setupAuthEnv()
    const app = await createApp({})
    const res = await app.request('/add-ons', {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nameI18n: { en: 'Fast wifi' },
        descriptionOverride: { en: 'Pocket wifi router' },
        priceJpy: 500,
        operatorId: seedId('op_mt_wiring'),
      }),
    })
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: { descriptionOverride: Record<string, string> } }
    expect(data.descriptionOverride).toEqual({
      en: 'Pocket wifi router',
      ja: '[ja] Pocket wifi router',
      zh: '[zh] Pocket wifi router',
    })
  })
})
```

- [ ] **Step 2: Run to verify it passes**

Run: `bun run --filter @kuruma/api test add-on-description-mt-wired`
Expected: PASS. (Guard test — green on write; its value is catching a future un-wiring. If it fails, the dev stub env assumption or the create wiring is wrong; do not weaken the assertion.)

Sabotage check: temporarily swap the real translator in `index.ts` for `{ fill: async (l, t) => ({ [l]: t }) }` and confirm this test goes RED, then restore.

- [ ] **Step 3: Commit**

```bash
git add packages/api/tests/routes/add-on-description-mt-wired.test.ts
git commit -m "test(#1318): wiring guard proves the real description translator MT-fills"
```

---

## Task 5: Web — thread the operator locale into add-on writes

Fixes a latent bug too: today the write response resolves to `en` regardless of the operator's locale, because no locale rides the POST/PATCH.

**Files:**
- Modify: `packages/web/src/vite/operator-add-ons/api.ts`
- Modify: `packages/web/src/vite/operator-add-ons/AddAddOnDialog.tsx`, `EditAddOnDialog.tsx`
- Test: `packages/web/src/vite/operator-add-ons/api.test.ts`

- [ ] **Step 1: Write the failing web test**

Create `packages/web/src/vite/operator-add-ons/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createAddOn, updateAddOn } from './api'

const addOn = {
  id: 'ao_1',
  operatorId: 'op_1',
  templateId: null,
  resolvedName: 'GPS',
  resolvedDescription: 'desc',
  descriptionOverride: { en: 'desc' },
  nameI18n: { en: 'GPS' },
  priceJpy: 1500,
  status: 'ACTIVE',
}

function mockOk() {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: addOn }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('operator add-on write api threads the locale', () => {
  it('createAddOn appends ?locale so the server knows the Model-B source locale', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await createAddOn({ nameI18n: { en: 'GPS' }, priceJpy: 1500, operatorId: 'op_1' }, 'csrf', 'ja')
    expect(f.mock.calls[0]?.[0]).toContain('locale=ja')
  })

  it('updateAddOn carries the locale alongside any operatorId', async () => {
    const f = mockOk()
    vi.stubGlobal('fetch', f)
    await updateAddOn('ao_1', { priceJpy: 2000 }, 'csrf', 'op_1', 'zh')
    const url = f.mock.calls[0]?.[0] as string
    expect(url).toContain('operatorId=op_1')
    expect(url).toContain('locale=zh')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run --filter @kuruma/web test operator-add-ons/api.test`
Expected: FAIL — `createAddOn`/`updateAddOn` do not accept a `locale` arg / do not append it.

- [ ] **Step 3: Implement the locale threading in `api.ts`**

Replace the `operatorQuery` helper and the two write functions:

```ts
// #1456 (operatorId) + #1318 (locale): compose the write query. `?operatorId=` binds
// a picker admin's PATCH/DELETE; `?locale=` tells the server the Model-B source locale
// (and resolves the write response to the operator's UI locale).
function writeQuery(pickedOperatorId?: string, locale?: Locale): string {
  const params = new URLSearchParams()
  if (pickedOperatorId) params.set('operatorId', pickedOperatorId)
  if (locale) params.set('locale', locale)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function createAddOn(
  input: WithOperatorId<CreateAddOnInput>,
  csrfToken: string,
  locale?: Locale,
): Promise<OperatorAddOnData> {
  return writeJson(`/add-ons${writeQuery(undefined, locale)}`, 'POST', input, csrfToken)
}

export async function updateAddOn(
  id: string,
  input: UpdateAddOnInput,
  csrfToken: string,
  pickedOperatorId?: string,
  locale?: Locale,
): Promise<OperatorAddOnData> {
  const path = `/add-ons/${encodeURIComponent(id)}${writeQuery(pickedOperatorId, locale)}`
  return writeJson(path, 'PATCH', input, csrfToken)
}
```

Update `archiveAddOn` to reuse `writeQuery` for its `operatorId` (no locale needed — archive does not touch descriptions):

```ts
export async function archiveAddOn(
  id: string,
  csrfToken: string,
  pickedOperatorId?: string,
): Promise<OperatorAddOnData> {
  const path = `/add-ons/${encodeURIComponent(id)}${writeQuery(pickedOperatorId)}`
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  return unwrap(res, addOnSchema)
}
```

Delete the now-unused `operatorQuery` function. `Locale` is already imported at the top of `api.ts`.

- [ ] **Step 4: Pass `locale` from the dialogs**

In `packages/web/src/vite/operator-add-ons/AddAddOnDialog.tsx`, change the mutationFn (L48):

```ts
    mutationFn: (data: WithOperatorId<CreateAddOnInput>) => createAddOn(data, csrfToken, locale),
```

In `packages/web/src/vite/operator-add-ons/EditAddOnDialog.tsx`, change the mutationFn (L38-39):

```ts
    mutationFn: (data: UpdateAddOnInput) =>
      updateAddOn(addOn?.id ?? '', data, csrfToken, pickedOperatorId, locale),
```

(Both dialogs already compute `const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `bun run --filter @kuruma/web test operator-add-ons`
Expected: PASS (new api.test + existing description-override/name-bundle tests).
Run: `bunx tsc --noEmit -p packages/web`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/vite/operator-add-ons/api.ts \
  packages/web/src/vite/operator-add-ons/AddAddOnDialog.tsx \
  packages/web/src/vite/operator-add-ons/EditAddOnDialog.tsx \
  packages/web/src/vite/operator-add-ons/api.test.ts
git commit -m "feat(#1318): thread operator locale into add-on writes (Model-B source)"
```

---

## Task 6: Full verification

- [ ] **Step 1: API + shared + web suites**

Run: `bun run --filter @kuruma/api test && bun run --filter @kuruma/web test`
Expected: all green.

- [ ] **Step 2: Typecheck, lint, boundaries, size**

Run: `bunx tsc --noEmit -p packages/api && bunx tsc --noEmit -p packages/web && bun run lint && bun run --filter @kuruma/api lint:boundaries && bun run lint:size`
Expected: clean. `description-translation.ts` imports `@sentry/cloudflare` (a boundary-neutral infra import, same as `error-handlers.ts`); the layer lint only guards routes→services→repositories direction.

- [ ] **Step 3: Rebase + push + PR**

```bash
git fetch origin && git rebase origin/develop
git push -u origin feat/1318-addon-description-mt
```

Open the PR: `Refs #1318` (the epic stays open — this is the add-on-description slice only; insurance + location MT remain deferred). Body: link the design doc, list HIGH-1/HIGH-2/MEDIUM-3/4/5 coverage, note the accepted limitations (MT owns non-source locales; editing under a different UI locale re-bases the source).

---

## Self-Review

**Spec coverage:**
- MT on save into remaining SUPPORTED_LOCALES → Task 1 (fill) + Task 2 (create) + Task 3 (update).
- Best-effort, silent-on-save → Task 1 (allSettled, drop-and-log) + Task 3 (failure-safe test).
- Model B single-source, refreshed → Task 2/3 (fill on each save from `bag[locale]`).
- Author-time persist → create/update write the filled bag; reads unchanged.
- Source = `?locale=` → route already threads it; service param `locale` is the source.
- HIGH-1 picked verbatim → `resolveDescriptionOverride` guard + create/update tests.
- HIGH-2 no coercion / source-agnostic → `if (!sourceText) return incoming` + create test.
- MEDIUM-3 required param + wired-test → Task 2 constructor + Task 4.
- MEDIUM-4 console.error + Sentry → Task 1 impl + drop test.
- MEDIUM-5 wire in index.ts:498 → Task 2 Step 3.
- LOW-6 bounded deadline → parallel allSettled (documented as the cap; no extra timer, YAGNI).
- NIT-7 dev stub `[ja] …` persistence → surfaced by the Task 4 wiring assertion (expected).
- Web `&locale=` → Task 5.

**Placeholder scan:** none — every code step carries full code.

**Type consistency:** `DescriptionTranslator.fill(sourceLocale, sourceText)` and `resolveDescriptionOverride(isSelfAuthored, locale, incoming, existingBag)` signatures match across Tasks 1-3; `writeQuery(pickedOperatorId?, locale?)` used consistently in Task 5. Constructor arg order (repo, templateRepo, descriptionTranslator, isSharedCatalogEnabled) is identical at every rewired site.
</content>
</invoke>
