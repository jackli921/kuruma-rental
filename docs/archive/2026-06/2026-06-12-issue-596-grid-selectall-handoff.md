# Handoff — #596 grid per-group + top-level select-all (Vite)

**State: RED done, GREEN not written.** Worktree `~/Dev/kuruma-596-grid-selectall`, branch `feat/596-grid-selectall` (pushed, tip `a17e0db` = failing tests). Off `marketplace-pivot`@c97e297 (includes #561 grid + #598 read-only). #596 in-progress, no PR. Web-only, no API/schema/migration.

## What #596 adds
The fleet **row** view (FleetTable) has a header select-all; the **grid** view (FleetGrid, #561) only has per-card selection. Add: (1) **per-group (per-class) select-all** checkbox in each FleetGrid group header, (2) a **top-level** grid select-all (whole visible fleet). Both `canWrite`-gated (read-only bypass roles, #598).

## Tests already written (RED) — `tests/vite/operator-fleet/OperatorFleetView.test.tsx`
5 new cases at end of file: per-group selects one class only (`Select all Compact` → "2 vehicles selected"), toggles back off, indeterminate on partial, top-level `bulk.selectAll` → "3 vehicles selected", and read-only absence. Run: `bun run --filter @kuruma/web test OperatorFleetView` (currently 4 fail / 20 pass; the read-only one already passes).

## GREEN steps (exact)
1. **i18n** add `business.vehicles.bulk.selectGroup` after the `selectRow` line in en/ja/zh:
   - en `"Select all {group}"` · ja `"{group}をすべて選択"` · zh `"全选{group}"`. Parity becomes 814×3.
2. **`OperatorFleetView.tsx`** add:
   ```ts
   const toggleGroup = (ids: readonly string[]) =>
     setSelectedIds((prev) =>
       ids.every((id) => prev.includes(id))
         ? prev.filter((id) => !ids.includes(id))
         : [...new Set([...prev, ...ids])])
   ```
   Pass to `<FleetGrid>`: `onToggleGroup={toggleGroup}` + `allSelected` + `someSelected` + `onToggleAll={toggleAll}` (all already computed in the container for FleetTable).
3. **`FleetGrid.tsx`** add those 4 props + `const tBulk = useTranslations('business.vehicles.bulk')`.
   - **Top-level**: a `canWrite`-gated row above `groups.map`: `<input type="checkbox" aria-label={tBulk('selectAll')} checked={allSelected} ref={el=>{if(el)el.indeterminate=someSelected}} onChange={onToggleAll}/>`.
   - **Per-group**: restructure the header — the collapse `<button>` and a NEW sibling `<input>` go inside one flex `<div>` (NEVER nest the checkbox in the button → invalid HTML/button-in-button). Per group: `const ids = group.vehicles.map(v=>v.id); const all = ids.every(id=>selectedIds.includes(id)); const some = ids.some(id=>selectedIds.includes(id)) && !all`. Checkbox `canWrite`-gated, `aria-label={tBulk('selectGroup',{group:group.className})}`, `checked={all}`, `ref` sets `.indeterminate=some`, `onChange={()=>onToggleGroup(ids)}`.
4. **Comments**: drop the "header select-all is row-view only" note in `FleetTable.tsx` and `FleetVehicleCard.tsx` — parity now exists.

## Gotchas
- The read-only grid test asserts `queryAllByRole('checkbox')` length 0 → EVERY new checkbox must be `canWrite`-gated.
- `getByRole('checkbox',{name:'Select all'})` is exact-match → won't collide with `'Select all Compact'`.
- localStorage view-mode persists across tests → `beforeEach(localStorage.clear())` already present.
- biome auto-formats; re-read after commit (pre-commit runs biome+size+modules+tsc).

## Finish the drill
Full web suite green + tsc 0 + biome + i18n parity 814×3 → `/code-review` + `architect` agent → PR (Closes #596, base `marketplace-pivot`) → `gh pr update-branch` if BEHIND (NO rebase/force-push) → CI 4/4 → squash merge → manual close #596 + drop in-progress label (base≠default) → `git worktree remove` + `git branch -d`.
