import type { Pool } from 'pg'
import { z } from 'zod'

const PriceSchema = z.number().int().min(0).max(2_147_483_647).nullable()
const CatalogProductStatusSchema = z.enum(['draft', 'published'])

const MonthlyTierSchema = z.object({
  code: z.enum(['lunar', 'solar', 'stellar']),
  monthlyPriceMinor: PriceSchema,
  status: CatalogProductStatusSchema
}).strict()

const AddOnProductSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  tokens: z.number().int().min(1).max(2_147_483_647),
  priceMinor: PriceSchema,
  status: CatalogProductStatusSchema
}).strict()

export const ConsumerTokenCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  baseMonthlyTokens: z.number().int().min(1).max(715_827_882),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tiers: z.tuple([
    MonthlyTierSchema.extend({ code: z.literal('lunar') }),
    MonthlyTierSchema.extend({ code: z.literal('solar') }),
    MonthlyTierSchema.extend({ code: z.literal('stellar') })
  ]),
  addOns: z.array(AddOnProductSchema).max(100)
}).strict().superRefine((catalog, context) => {
  if (catalog.tiers.some((tier) => tier.status === 'published' && tier.monthlyPriceMinor === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['tiers'], message: 'Published tiers require a price' })
  }
  if (catalog.addOns.some((product) => product.status === 'published' && product.priceMinor === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['addOns'], message: 'Published add-ons require a price' })
  }
  const codes = catalog.addOns.map((product) => product.code)
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['addOns'], message: 'Add-on codes must be unique' })
  }
})

export type ConsumerTokenCatalog = z.infer<typeof ConsumerTokenCatalogSchema>

export interface ConsumerTokenCatalogStore {
  get(): Promise<ConsumerTokenCatalog | null>
  save(actorSubjectId: string, catalog: ConsumerTokenCatalog): Promise<ConsumerTokenCatalog | 'conflict'>
}

export function createPostgresConsumerTokenCatalogStore(pool: Pool): ConsumerTokenCatalogStore {
  return {
    async get() {
      const result = await pool.query<{ revision: number; catalog: unknown }>(
        `SELECT revision, catalog FROM gptmd_consumer_token_catalog WHERE catalog_id = 1`
      )
      const row = result.rows[0]
      if (!row) return null
      return ConsumerTokenCatalogSchema.parse({ ...row.catalog as object, revision: row.revision })
    },

    async save(actorSubjectId, catalog) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT pg_advisory_xact_lock(hashtext('gptmd_consumer_token_catalog'))")
        const current = await client.query<{ revision: number; catalog: unknown }>(
          `SELECT revision, catalog FROM gptmd_consumer_token_catalog WHERE catalog_id = 1 FOR UPDATE`
        )
        const currentRevision = current.rows[0]?.revision ?? 0
        if (catalog.revision !== currentRevision) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        const revision = currentRevision + 1
        const nextCatalog = ConsumerTokenCatalogSchema.parse({ ...catalog, revision })
        await client.query(
          `INSERT INTO gptmd_consumer_token_catalog (catalog_id, revision, catalog, changed_by)
           VALUES (1, $1, $2::jsonb, $3)
           ON CONFLICT (catalog_id) DO UPDATE
             SET revision = EXCLUDED.revision, catalog = EXCLUDED.catalog,
                 changed_by = EXCLUDED.changed_by, changed_at = now()`,
          [revision, JSON.stringify(nextCatalog), actorSubjectId]
        )
        await client.query(
          `INSERT INTO gptmd_consumer_token_catalog_audit (revision, changed_by, catalog)
           VALUES ($1, $2, $3::jsonb)`,
          [revision, actorSubjectId, JSON.stringify(nextCatalog)]
        )
        await client.query('COMMIT')
        return nextCatalog
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}

export function parseConsumerTokenCatalog(value: unknown): ConsumerTokenCatalog | null {
  const parsed = ConsumerTokenCatalogSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function projectConsumerStoreCatalog(catalog: ConsumerTokenCatalog | null) {
  if (!catalog) return { revision: 0, currency: null, products: [], checkoutEnabled: false as const }
  const multipliers = { lunar: 1, solar: 2, stellar: 3 } as const
  const tiers = catalog.tiers.flatMap((tier) => tier.status === 'published'
    ? [{
        code: tier.code,
        kind: 'monthly_tier' as const,
        tokens: catalog.baseMonthlyTokens * multipliers[tier.code],
        priceMinor: tier.monthlyPriceMinor,
        currency: catalog.currency
      }]
    : [])
  const addOns = catalog.addOns.flatMap((product) => product.status === 'published'
    ? [{
        code: product.code,
        name: product.name,
        description: product.description,
        kind: 'token_addon' as const,
        tokens: product.tokens,
        priceMinor: product.priceMinor,
        currency: catalog.currency
      }]
    : [])
  return {
    revision: catalog.revision,
    currency: catalog.currency,
    products: [...tiers, ...addOns],
    checkoutEnabled: false as const
  }
}
