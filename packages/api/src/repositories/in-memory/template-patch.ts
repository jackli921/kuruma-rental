import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import type { AddOnTemplate, InsuranceTemplate } from '../../stores'

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
