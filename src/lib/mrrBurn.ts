/**
 * Ops MRR + burn model for Admin → Analytics → MRR & burn.
 * Quantities are editable in the UI; unit prices default from Oct 2026 receipts/notes.
 */

export type Money = number

export type RevenueSlice = {
  id: 'monthly' | 'annual'
  label: string
  /** Paying subscriptions in this bucket. */
  count: number
  /** Gross MRR from RevenueCat for this bucket (before store cut). */
  mrr: Money
}

export type CostLine = {
  id: string
  label: string
  /** What the quantity counts (seat, env, month…). */
  unitLabel: string
  unitPrice: Money
  qty: number
  /** Short note under the row. */
  note?: string
  /** When false, line is excluded from totals (cancelled / moved to free). */
  enabled: boolean
  /** User-added line (not in built-in defaults). */
  custom?: boolean
}

const CUSTOM_ID_PREFIX = 'custom_'

export function isCustomCostLine(line: Pick<CostLine, 'id' | 'custom'>): boolean {
  return line.custom === true || String(line.id || '').startsWith(CUSTOM_ID_PREFIX)
}

export function newCustomCostLine(): CostLine {
  return {
    id: `${CUSTOM_ID_PREFIX}${Date.now().toString(36)}`,
    label: 'New expense',
    unitLabel: 'month',
    unitPrice: 0,
    qty: 1,
    enabled: true,
    custom: true,
  }
}

export type MrrBurnState = {
  revenue: RevenueSlice[]
  /** Assumed App Store / Play cut on subscription revenue (0–1). */
  storeCutRate: number
  costs: CostLine[]
}

export const MRR_BURN_STORAGE_KEY = 'admin_mrr_burn_v1'

/** Defaults from Urgi’s Oct 2026 notes (RevenueCat + known tools). */
export function defaultMrrBurnState(): MrrBurnState {
  return {
    storeCutRate: 0.15,
    revenue: [
      { id: 'monthly', label: 'Monthly subs', count: 5, mrr: 41.95 },
      { id: 'annual', label: 'Annual → monthly', count: 6, mrr: 31.54 },
    ],
    costs: [
      {
        id: 'content',
        label: 'Content',
        unitLabel: 'month',
        unitPrice: 150,
        qty: 1,
        note: 'Held at $150 / month',
        enabled: true,
      },
      {
        id: 'expo',
        label: 'Expo',
        unitLabel: 'base plan',
        unitPrice: 19,
        qty: 1,
        note: 'Local builds only. Cloud overage was ~$156 in Sep — keep qty 1 at $19.',
        enabled: true,
      },
      {
        id: 'google_workspace',
        label: 'Google Workspace',
        unitLabel: 'seat',
        unitPrice: 33,
        qty: 2,
        note: '~$66 for 2 seats · ~$36 for admin@ alone (set qty 1)',
        enabled: true,
      },
      {
        id: 'supabase',
        label: 'Supabase',
        unitLabel: 'environment',
        unitPrice: 16.33,
        qty: 3,
        note: 'Prod + staging + branches ≈ $49 total at 3 envs',
        enabled: true,
      },
      {
        id: 'vercel',
        label: 'Vercel',
        unitLabel: 'plan',
        unitPrice: 0,
        qty: 1,
        note: 'Moved to free (was Pro ~$22)',
        enabled: true,
      },
      {
        id: 'claude',
        label: 'Claude',
        unitLabel: 'seat',
        unitPrice: 20,
        qty: 1,
        note: 'Back on Claude ~$20 / month',
        enabled: true,
      },
      {
        id: 'chatgpt',
        label: 'ChatGPT Plus',
        unitLabel: 'seat',
        unitPrice: 20,
        qty: 1,
        note: 'Unconfirmed from receipts — edit or set qty 0',
        enabled: true,
      },
      {
        id: 'cursor',
        label: 'Cursor',
        unitLabel: 'seat',
        unitPrice: 64.86,
        qty: 1,
        note: 'Pro+ $60 + tax · renewed Aug 31 at $64.86',
        enabled: true,
      },
      {
        id: 'google_cloud',
        label: 'Google Cloud',
        unitLabel: 'month',
        unitPrice: 4,
        qty: 1,
        enabled: true,
      },
      {
        id: 'apple_dev',
        label: 'Apple Developer',
        unitLabel: 'month',
        unitPrice: 8.5,
        qty: 1,
        note: '$99 / year ≈ $8.50 / month',
        enabled: true,
      },
      {
        id: 'domain',
        label: 'Domain',
        unitLabel: 'month',
        unitPrice: 1.5,
        qty: 1,
        enabled: true,
      },
      {
        id: 'ipostal',
        label: 'iPostal',
        unitLabel: 'month',
        unitPrice: 5,
        qty: 1,
        enabled: true,
      },
    ],
  }
}

export function lineTotal(line: CostLine): Money {
  if (!line.enabled) return 0
  const qty = Math.max(0, Number(line.qty) || 0)
  const price = Math.max(0, Number(line.unitPrice) || 0)
  return qty * price
}

export function sumGrossMrr(revenue: RevenueSlice[]): Money {
  return revenue.reduce((s, r) => s + (Number(r.mrr) || 0), 0)
}

export function sumSubCount(revenue: RevenueSlice[]): number {
  return revenue.reduce((s, r) => s + Math.max(0, Math.floor(Number(r.count) || 0)), 0)
}

export function sumCosts(costs: CostLine[]): Money {
  return costs.reduce((s, c) => s + lineTotal(c), 0)
}

export function netAfterStoreCut(grossMrr: Money, storeCutRate: number): Money {
  const rate = Math.min(1, Math.max(0, Number(storeCutRate) || 0))
  return grossMrr * (1 - rate)
}

export function formatUsd(n: Money, digits = 2): string {
  const v = Number.isFinite(n) ? n : 0
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(digits)}`
}

/** Merge saved qty / prices onto defaults so new cost lines still appear after updates. */
export function mergeMrrBurnState(saved: Partial<MrrBurnState> | null | undefined): MrrBurnState {
  const base = defaultMrrBurnState()
  if (!saved || typeof saved !== 'object') return base

  const storeCutRate =
    typeof saved.storeCutRate === 'number' && Number.isFinite(saved.storeCutRate)
      ? saved.storeCutRate
      : base.storeCutRate

  const revenue = base.revenue.map((slice) => {
    const hit = Array.isArray(saved.revenue)
      ? saved.revenue.find((r) => r && r.id === slice.id)
      : null
    if (!hit) return slice
    return {
      ...slice,
      count: Number.isFinite(Number(hit.count)) ? Number(hit.count) : slice.count,
      mrr: Number.isFinite(Number(hit.mrr)) ? Number(hit.mrr) : slice.mrr,
    }
  })

  const savedCosts = Array.isArray(saved.costs) ? saved.costs : []
  const costs = base.costs.map((line) => {
    const hit = savedCosts.find((c) => c && c.id === line.id)
    if (!hit) return line
    return {
      ...line,
      unitPrice: Number.isFinite(Number(hit.unitPrice)) ? Number(hit.unitPrice) : line.unitPrice,
      qty: Number.isFinite(Number(hit.qty)) ? Number(hit.qty) : line.qty,
      enabled: typeof hit.enabled === 'boolean' ? hit.enabled : line.enabled,
    }
  })

  const knownIds = new Set(base.costs.map((c) => c.id))
  for (const raw of savedCosts) {
    if (!raw || typeof raw !== 'object') continue
    if (!isCustomCostLine(raw) || knownIds.has(raw.id)) continue
    const label = String(raw.label ?? '').trim() || 'Expense'
    costs.push({
      id: String(raw.id),
      label,
      unitLabel: String(raw.unitLabel ?? 'month').trim() || 'month',
      unitPrice: Number.isFinite(Number(raw.unitPrice)) ? Number(raw.unitPrice) : 0,
      qty: Number.isFinite(Number(raw.qty)) ? Number(raw.qty) : 1,
      note: typeof raw.note === 'string' ? raw.note : undefined,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
      custom: true,
    })
  }

  return { storeCutRate, revenue, costs }
}
