import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { ADD_ON_STATUSES, CATALOG_TEMPLATE_STATUSES } from '../enums'
import type { LocalizedText, LocalizedTextOverride } from '../i18n/localized-text'
import { operators } from './auth'

export const addOnStatusEnum = pgEnum('add_on_status', ADD_ON_STATUSES)

// Shared by add_on_templates and (slice 3) insurance_templates — one CREATE TYPE
// for both platform-owned catalog template tables.
export const catalogTemplateStatusEnum = pgEnum(
  'catalog_template_status',
  CATALOG_TEMPLATE_STATUSES,
)

// Operator-owned paid add-ons (epic #385, slice #460). Selectable priced items
// chosen in the booking wizard (baby seat, ETC card…). priceJpy is a FLAT
// per-booking charge — distinct from insurance_options (per-day) and from
// fee_schedules (potential post-rental charges). At booking the renter picks
// from the operator's active list; the chosen add-ons + price snapshot onto
// bookings.addOnSnapshot. Structure mirrors insurance_options exactly.
export const addOnOptions = pgTable(
  'add_on_options',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant owner. NOT NULL — same fresh-branch reseed rationale as
    // insuranceOptions.operatorId (#404); no nullable tenancy debt.
    operatorId: text('operatorId')
      .notNull()
      .references(() => operators.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    // Catalog i18n (slice 2): the platform template this add-on instances — the
    // template supplies the localized name. Nullable through PR1 (the backfill
    // sets every active row); NOT NULL in PR2 (slice 5). onDelete 'restrict'
    // matches the operators FK convention — a referenced template can't vanish.
    templateId: text('templateId').references(() => addOnTemplates.id, { onDelete: 'restrict' }),
    // Operator's reworded description as a PARTIAL locale bag (P1-a override type,
    // NOT LocalizedText — an operator may author one locale only; deferred MT
    // fills the remaining keys in place). Nullable: most rows keep the template's.
    descriptionOverride: jsonb('descriptionOverride').$type<LocalizedTextOverride>(),
    // SELF-AUTHORED name (#1437): the operator's own {en, ja?, zh?} bundle for an
    // item that does NOT pick a shared template. Full LocalizedText (en required)
    // so a self-authored item always has a floor. Null for a PICKED row (the
    // template supplies the name) and for a legacy row (falls back to `name`). A
    // row is picked XOR self-authored — the not-both CHECK below seals it.
    nameI18n: jsonb('nameI18n').$type<LocalizedText>(),
    priceJpy: integer('priceJpy').notNull(),
    status: addOnStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_add_on_options_operatorId').on(table.operatorId),
    // Composite-unique so a future composite FK can seal a referrer to the
    // add-on's own tenant (mirrors insurance_options_operatorId_id_unique).
    unique('add_on_options_operatorId_id_unique').on(table.operatorId, table.id),
    // Name uniqueness scoped to ACTIVE rows so archiving frees the name for
    // reuse (mirrors insurance_options_active_name_unique). PARTIAL index.
    uniqueIndex('add_on_options_active_name_unique')
      .on(table.operatorId, table.name)
      .where(sql`status = 'ACTIVE'`),
    // Leading FK-cover index (lint-fk-indexes counts only the LEADING column of an
    // index; PR2's composite would leave templateId trailing and uncounted).
    index('idx_add_on_options_templateId').on(table.templateId),
    // Catalog i18n (P1-b): an operator can't hold the same template twice while
    // ACTIVE. The WHERE predicate is the OPERATOR ROW status (add_on_status), NOT
    // the template status (which gates picker visibility, a separate axis). Kept
    // ALONGSIDE active_name_unique through PR1 (expand-contract): a partial unique
    // on templateId does not catch duplicate NULLs, so null-templateId rows in the
    // migration-before-code window stay guarded by the name index; active_name_unique
    // drops with the name column in PR2 (slice 5).
    uniqueIndex('add_on_options_active_template_unique')
      .on(table.operatorId, table.templateId)
      .where(sql`status = 'ACTIVE'`),
    check('add_on_options_price_non_negative', sql`${table.priceJpy} >= 0`),
    // A row is PICKED (templateId) XOR SELF-AUTHORED (nameI18n) — never both (#1437).
    // A both-set row would hit the template branch at resolution and silently discard
    // the operator's nameI18n; forbid it at the DB. Both-null stays permitted (legacy
    // rows fall back to the `name` column).
    check(
      'add_on_options_not_both_identities',
      sql`NOT (${table.templateId} IS NOT NULL AND ${table.nameI18n} IS NOT NULL)`,
    ),
  ],
)

// Platform-owned, pre-translated add-on TEMPLATES (catalog i18n). An operator
// picks a template instead of typing a raw name, so a renter reading in ja/zh
// sees a translated add-on name rather than the operator's English string. name
// and description are LocalizedText JSONB {en, ja?, zh?} bundles resolved to the
// caller locale in the service layer. NO operatorId — the catalog is global,
// shared across every tenant (a picker, not tenant data). key = slugify(canonical
// English name); the curated seed and the slice-2 backfill both derive it, so it
// is the stable join handle between an operator's legacy name and its template.
export const addOnTemplates = pgTable(
  'add_on_templates',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    key: text('key').notNull(),
    name: jsonb('name').$type<LocalizedText>().notNull(),
    // Nullable: not every template ships a curated description bundle.
    description: jsonb('description').$type<LocalizedText>(),
    status: catalogTemplateStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('add_on_templates_key_unique').on(table.key)],
)
