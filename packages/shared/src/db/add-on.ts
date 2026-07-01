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
import type { LocalizedText } from '../i18n/localized-text'
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
    check('add_on_options_price_non_negative', sql`${table.priceJpy} >= 0`),
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
