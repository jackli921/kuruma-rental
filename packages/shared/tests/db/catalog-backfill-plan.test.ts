import { describe, expect, it } from 'vitest'
import {
  type AddOnRowFact,
  type TemplateFact,
  planCatalogBackfill,
} from '../../src/db/backfill-catalog-templates'

// Pure-planner unit tests for the catalog (add-on) template backfill. The DB
// shell (`backfillCatalogTemplates`) is exercised end-to-end against real
// Postgres in `packages/api/tests/integration/backfill-catalog-templates.test.ts`;
// these fast tests pin the map-or-mint-or-merge DECISION in isolation.

const CHILD_SEAT: TemplateFact = {
  id: 'tmpl_child_seat',
  key: 'child_seat',
  enName: 'Child seat',
  enDescription: 'Rear-facing or booster seat, fitted at pickup.',
}

const ETC_CARD: TemplateFact = {
  id: 'tmpl_etc_card',
  key: 'etc_card',
  enName: 'ETC card',
  enDescription: 'Expressway toll card.',
}

// A deterministic, monotonic id source so mint ordering is assertable.
function mintCounter(): () => string {
  let n = 0
  return () => `minted_${++n}`
}

// Fails the test if the planner mints when it should only map.
const neverMint = (): string => {
  throw new Error('planner minted a template when an existing key should have matched')
}

function row(over: Partial<AddOnRowFact> & Pick<AddOnRowFact, 'id'>): AddOnRowFact {
  return {
    operatorId: 'op_a',
    name: 'Child seat',
    description: null,
    status: 'ACTIVE',
    templateId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }
}

describe('planCatalogBackfill', () => {
  it('maps a null-templateId row onto the template whose key equals slugify(name)', () => {
    const plan = planCatalogBackfill(
      [CHILD_SEAT],
      [row({ id: 'r1', name: 'Child seat' })],
      neverMint,
    )

    expect(plan.mints).toEqual([])
    expect(plan.archives).toEqual([])
    expect(plan.stamps).toEqual([
      { id: 'r1', templateId: 'tmpl_child_seat', descriptionOverride: null },
    ])
  })

  it('migrates a description that differs from the template en into descriptionOverride', () => {
    const plan = planCatalogBackfill(
      [CHILD_SEAT],
      [row({ id: 'r1', name: 'Child seat', description: 'We fit it for you at the desk.' })],
      neverMint,
    )

    expect(plan.stamps).toEqual([
      {
        id: 'r1',
        templateId: 'tmpl_child_seat',
        descriptionOverride: { en: 'We fit it for you at the desk.' },
      },
    ])
  })

  it('leaves descriptionOverride null when the description equals the template en default', () => {
    const plan = planCatalogBackfill(
      [CHILD_SEAT],
      [row({ id: 'r1', name: 'Child seat', description: CHILD_SEAT.enDescription })],
      neverMint,
    )

    expect(plan.stamps[0]?.descriptionOverride).toBeNull()
  })

  it('maps a case/punctuation name variant onto the curated template via slugify', () => {
    // "ETC  Card" (double space, mixed case) slugifies to the curated 'etc_card'.
    const plan = planCatalogBackfill(
      [ETC_CARD],
      [row({ id: 'r1', name: 'ETC  Card', description: null })],
      neverMint,
    )

    expect(plan.stamps).toEqual([
      { id: 'r1', templateId: 'tmpl_etc_card', descriptionOverride: null },
    ])
  })

  it('mints an ARCHIVED en-only template for an orphan name and stamps the row onto it', () => {
    const plan = planCatalogBackfill(
      [CHILD_SEAT],
      [row({ id: 'r1', name: 'Roof box', description: 'Big roof storage.' })],
      mintCounter(),
    )

    expect(plan.mints).toEqual([{ id: 'minted_1', key: 'roof_box', name: { en: 'Roof box' } }])
    expect(plan.stamps).toEqual([
      { id: 'r1', templateId: 'minted_1', descriptionOverride: { en: 'Big roof storage.' } },
    ])
  })

  it('mints once for two rows sharing an orphan slug; the second maps onto the mint', () => {
    const plan = planCatalogBackfill(
      [],
      [
        row({ id: 'r1', operatorId: 'op_a', name: 'Roof box' }),
        row({
          id: 'r2',
          operatorId: 'op_b',
          name: 'roof  box',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ],
      mintCounter(),
    )

    expect(plan.mints).toEqual([{ id: 'minted_1', key: 'roof_box', name: { en: 'Roof box' } }])
    expect(plan.stamps).toEqual([
      { id: 'r1', templateId: 'minted_1', descriptionOverride: null },
      { id: 'r2', templateId: 'minted_1', descriptionOverride: null },
    ])
  })

  describe('intra-operator merge', () => {
    it('keeps the oldest and archives the newer duplicate when neither is customized', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({ id: 'old', name: 'Child seat', createdAt: new Date('2026-01-01T00:00:00Z') }),
          row({ id: 'new', name: 'child  seat', createdAt: new Date('2026-02-01T00:00:00Z') }),
        ],
        neverMint,
      )

      expect(plan.archives).toEqual(['new'])
      // Losers are still stamped (every row needs a templateId for the PR2 NOT NULL).
      expect(plan.stamps).toEqual([
        { id: 'old', templateId: 'tmpl_child_seat', descriptionOverride: null },
        { id: 'new', templateId: 'tmpl_child_seat', descriptionOverride: null },
      ])
    })

    it('keeps the customized row even when a non-customized duplicate is older', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({
            id: 'old_plain',
            name: 'Child seat',
            description: CHILD_SEAT.enDescription,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          }),
          row({
            id: 'new_custom',
            name: 'Child Seat',
            description: 'Fitted by our staff at the desk.',
            createdAt: new Date('2026-02-01T00:00:00Z'),
          }),
        ],
        neverMint,
      )

      expect(plan.archives).toEqual(['old_plain'])
      expect(plan.stamps).toContainEqual({
        id: 'new_custom',
        templateId: 'tmpl_child_seat',
        descriptionOverride: { en: 'Fitted by our staff at the desk.' },
      })
    })

    it('does NOT merge duplicates across different operators', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({ id: 'a', operatorId: 'op_a', name: 'Child seat' }),
          row({ id: 'b', operatorId: 'op_b', name: 'Child seat' }),
        ],
        neverMint,
      )

      expect(plan.archives).toEqual([])
    })

    it('ignores ARCHIVED rows when detecting duplicates but still stamps them', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({ id: 'active', name: 'Child seat', status: 'ACTIVE' }),
          row({ id: 'archived', name: 'Child seat', status: 'ARCHIVED' }),
        ],
        neverMint,
      )

      expect(plan.archives).toEqual([])
      expect(plan.stamps).toContainEqual({
        id: 'archived',
        templateId: 'tmpl_child_seat',
        descriptionOverride: null,
      })
    })

    it('archives a null duplicate that collides with an already-templated active row', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({
            id: 'templated',
            name: 'Child seat',
            templateId: 'tmpl_child_seat',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          }),
          row({
            id: 'null_dup',
            name: 'child seat',
            templateId: null,
            createdAt: new Date('2026-02-01T00:00:00Z'),
          }),
        ],
        neverMint,
      )

      // The already-templated older row is the keeper; the newer null row loses.
      expect(plan.archives).toEqual(['null_dup'])
      // The keeper already has its templateId, so only the null loser is stamped.
      expect(plan.stamps).toEqual([
        { id: 'null_dup', templateId: 'tmpl_child_seat', descriptionOverride: null },
      ])
    })

    it('collapses a three-row duplicate group to the single oldest keeper', () => {
      const plan = planCatalogBackfill(
        [CHILD_SEAT],
        [
          row({ id: 'a', name: 'Child seat', createdAt: new Date('2026-01-01T00:00:00Z') }),
          row({ id: 'b', name: 'Child Seat', createdAt: new Date('2026-01-02T00:00:00Z') }),
          row({ id: 'c', name: 'child  seat', createdAt: new Date('2026-01-03T00:00:00Z') }),
        ],
        neverMint,
      )

      expect(plan.archives).toEqual(['b', 'c'])
      expect(plan.stamps.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    })
  })

  it('produces an empty plan when every row already has a templateId (idempotent re-run)', () => {
    const plan = planCatalogBackfill(
      [CHILD_SEAT],
      [row({ id: 'r1', name: 'Child seat', templateId: 'tmpl_child_seat' })],
      neverMint,
    )

    expect(plan).toEqual({ mints: [], archives: [], stamps: [] })
  })
})
