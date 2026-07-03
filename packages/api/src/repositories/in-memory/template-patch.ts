import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import { PG_ERROR } from '../../pg-errors'
import type { AddOnTemplate, InsuranceTemplate } from '../../stores'
import type { TemplateCreateInput } from '../types'

/**
 * Pure in-memory application of a #1319 admin template patch: return a NEW row
 * with only the present fields overwritten (an absent key leaves the current
 * value; `description: null` is a real clear, so `!== undefined` — never a
 * truthiness check — decides each field) and `updatedAt` bumped. Shared by the
 * add-on and insurance in-memory repos, whose rows are structurally identical.
 */
export function mergeTemplatePatch<T extends AddOnTemplate | InsuranceTemplate>(
  row: T,
  patch: TemplatePatch,
): T {
  return {
    ...row,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: new Date(),
  }
}

// Mirror postgres-js's PostgresError shape (top-level `code` + `constraint_name`)
// so the create service's 23505 key-clash catch behaves identically against the
// in-memory and Drizzle repos (driver parity, #1362). Same pattern as consent.ts.
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

/**
 * In-memory template insert (#1319 slice 3): mint the id + timestamps the real DB
 * defaults, and enforce the per-catalog key-unique seal by throwing a 23505-shaped
 * error the service maps to 409 — the same path Postgres takes on `*_key_unique`.
 * Mutates `store`. `keyConstraint` is the real index name for a faithful error.
 */
export function insertTemplate<T extends AddOnTemplate | InsuranceTemplate>(
  store: Map<string, T>,
  input: TemplateCreateInput,
  keyConstraint: string,
): T {
  for (const existing of store.values()) {
    if (existing.key === input.key) throw uniqueViolation(keyConstraint)
  }
  const now = new Date()
  // The constructed object carries exactly the AddOnTemplate/InsuranceTemplate
  // fields; the cast reconciles the generic T (both are structurally identical).
  const row = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now } as T
  store.set(row.id, row)
  return row
}
