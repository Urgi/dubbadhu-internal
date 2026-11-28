import type { SupabaseClient } from '@supabase/supabase-js'
import { isAnalyticsExcludedUserId } from './analyticsExcludedUsers'
import {
  EXPERIMENT_EXPOSURE_EVENT_NAMES,
  eventArm,
  sinceIsoForRange,
  userMatchesExperimentCountry,
  type ExperimentCountryScope,
  type ExperimentDateRange,
} from './experimentResults'
import type { KnownExperiment } from './experiments'

/**
 * Experiment read-out from the shared metric views (prod migration 20261126130000_metric_definitions.sql):
 * metric_learner_returns (week-1 return), metric_trial_starts, metric_paid_learners.
 * The views have no anon/authenticated grants; the admin client uses the service role key (src/lib/supabase.ts).
 *
 * Arm = learner's first exposure to this experiment in the window. Left out: test accounts
 * (users.exclude_from_analytics + the hardcoded list) and Ethiopia free-lesson learners (premium_source = 'et_lessons').
 */

export type MetricKey = 'l1' | 'l2' | 'week1' | 'trial' | 'paid'

export type ArmMetricCounts = {
  arm: string
  label: string
  learners: number
  l1: number
  l2: number
  /** Learners whose week 1 is over (signup ≥ 14 days ago). Week-1 return is averaged over these only. */
  week1Matured: number
  week1Returned: number
  trial: number
  paid: number
}

export type MetricVerdictKind = 'not_enough' | 'chance' | 'likely_real' | 'no_control'

export type MetricVerdict = {
  kind: MetricVerdictKind
  text: string
  /** Arm compared to control, when there is one. */
  arm?: string
  diffPts?: number
  pValue?: number
}

export type ExperimentMetricRow = {
  key: MetricKey
  label: string
  /** Per arm: [hits, base] in arm order. */
  cells: Array<{ hits: number; base: number }>
  verdicts: MetricVerdict[]
}

export type ExperimentMetrics = {
  arms: ArmMetricCounts[]
  rows: ExperimentMetricRow[]
  excludedEt: number
  excludedTest: number
  truncated: boolean
}

export const METRIC_LABELS: Record<MetricKey, string> = {
  l1: 'Lesson 1 done',
  l2: 'Lesson 2 done',
  week1: 'Week-1 return',
  trial: 'Trial started',
  paid: 'Paid',
}

/** Below this many learners per arm, or events in both arms, we don't call it. */
export const MIN_LEARNERS_PER_ARM = 30
export const MIN_EVENTS = 5
export const SIGNIFICANCE = 0.05

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/** Two-sided pooled two-proportion z-test. Returns p = 1 when it can't be computed. */
export function twoProportionPValue(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1
  const p = (x1 + x2) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (!Number.isFinite(se) || se === 0) return 1
  const z = (x1 / n1 - x2 / n2) / se
  return 2 * (1 - normalCdf(Math.abs(z)))
}

export function verdictFor(
  control: { hits: number; base: number },
  arm: { hits: number; base: number },
  armLabel: string,
): MetricVerdict {
  if (
    control.base < MIN_LEARNERS_PER_ARM ||
    arm.base < MIN_LEARNERS_PER_ARM ||
    (control.hits < MIN_EVENTS && arm.hits < MIN_EVENTS)
  ) {
    return { kind: 'not_enough', text: 'Not enough data yet', arm: armLabel }
  }
  const diffPts = (arm.hits / arm.base - control.hits / control.base) * 100
  const pValue = twoProportionPValue(arm.hits, arm.base, control.hits, control.base)
  const signed = `${diffPts >= 0 ? '+' : ''}${diffPts.toFixed(1)} pts`
  if (pValue < SIGNIFICANCE) {
    return { kind: 'likely_real', text: `Likely real (${signed})`, arm: armLabel, diffPts, pValue }
  }
  return { kind: 'chance', text: `Difference could be chance (${signed})`, arm: armLabel, diffPts, pValue }
}

function cellFor(arm: ArmMetricCounts, key: MetricKey): { hits: number; base: number } {
  switch (key) {
    case 'l1':
      return { hits: arm.l1, base: arm.learners }
    case 'l2':
      return { hits: arm.l2, base: arm.learners }
    case 'week1':
      return { hits: arm.week1Returned, base: arm.week1Matured }
    case 'trial':
      return { hits: arm.trial, base: arm.learners }
    case 'paid':
      return { hits: arm.paid, base: arm.learners }
  }
}

/** First arm in the experiment definition is the control; every other arm is compared to it. */
export function buildMetricRows(arms: ArmMetricCounts[]): ExperimentMetricRow[] {
  const keys: MetricKey[] = ['l1', 'l2', 'week1', 'trial', 'paid']
  return keys.map((key) => {
    const cells = arms.map((a) => cellFor(a, key))
    const verdicts: MetricVerdict[] =
      arms.length < 2
        ? [{ kind: 'no_control', text: 'Only one arm' }]
        : arms.slice(1).map((a, i) => verdictFor(cells[0], cells[i + 1], a.label))
    return { key, label: METRIC_LABELS[key], cells, verdicts }
  })
}

export function formatCell(cell: { hits: number; base: number }): string {
  if (cell.base <= 0) return '—'
  return `${Math.round((cell.hits / cell.base) * 100)}% (${cell.hits}/${cell.base})`
}

const PAGE = 1000
const CAP = 20_000
const CHUNK = 150

type ExposureRow = { user_id: string | null; properties: Record<string, unknown> | null; created_at: string }

async function fetchExposures(
  client: SupabaseClient,
  experimentKey: string,
  sinceIso: string | null,
): Promise<{ rows: ExposureRow[]; error: string | null; truncated: boolean }> {
  const rows: ExposureRow[] = []
  for (let offset = 0; offset < CAP; offset += PAGE) {
    let q = client
      .from('analytics_events')
      .select('user_id, properties, created_at')
      .in('event_name', [...EXPERIMENT_EXPOSURE_EVENT_NAMES])
      .eq('properties->>experiment_key', experimentKey)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (sinceIso) q = q.gte('created_at', sinceIso)
    const { data, error } = await q
    if (error) return { rows, error: error.message, truncated: false }
    const batch = (data ?? []) as ExposureRow[]
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, error: null, truncated: false }
  }
  return { rows, error: null, truncated: true }
}

/** `select` over `user_id in (...)` in chunks; returns all rows. */
async function selectForUsers<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  userIds: string[],
  extra?: (q: any) => any,
): Promise<{ rows: T[]; error: string | null }> {
  const out: T[] = []
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK)
    for (let offset = 0; offset < CAP; offset += PAGE) {
      let q = client.from(table).select(columns).in(idColumn, chunk).range(offset, offset + PAGE - 1)
      if (extra) q = extra(q)
      const { data, error } = await q
      if (error) return { rows: out, error: `${table}: ${error.message}` }
      const batch = (data ?? []) as T[]
      out.push(...batch)
      if (batch.length < PAGE) break
    }
  }
  return { rows: out, error: null }
}

export async function fetchExperimentMetrics(
  client: SupabaseClient,
  experiment: KnownExperiment,
  range: ExperimentDateRange,
  countryScope: ExperimentCountryScope = 'all',
): Promise<{ data: ExperimentMetrics | null; error: string | null }> {
  const sinceIso = sinceIsoForRange(range)
  const exposures = await fetchExposures(client, experiment.key, sinceIso)
  if (exposures.error) return { data: null, error: exposures.error }

  const assignment = new Map<string, { arm: string; exposedAt: string }>()
  for (const row of exposures.rows) {
    const uid = row.user_id ? String(row.user_id) : ''
    if (!uid || assignment.has(uid)) continue
    const arm = eventArm(row.properties, experiment.key)
    if (arm) assignment.set(uid, { arm, exposedAt: row.created_at })
  }

  const users = await selectForUsers<{
    id: string
    phone: string | null
    exclude_from_analytics: boolean | null
    premium_source: string | null
  }>(client, 'users', 'id, phone, exclude_from_analytics, premium_source', 'id', [...assignment.keys()])
  if (users.error) return { data: null, error: users.error }

  let excludedEt = 0
  let excludedTest = 0
  const kept = new Set<string>()
  const userById = new Map(users.rows.map((u) => [String(u.id), u]))
  for (const uid of assignment.keys()) {
    const u = userById.get(uid)
    if (!u || u.exclude_from_analytics || isAnalyticsExcludedUserId(uid)) {
      excludedTest += 1
      continue
    }
    if (u.premium_source === 'et_lessons') {
      excludedEt += 1
      continue
    }
    if (!userMatchesExperimentCountry(u.phone ?? '', countryScope)) continue
    kept.add(uid)
  }
  const ids = [...kept]

  const [lessons, returns, trials, paid] = await Promise.all([
    selectForUsers<{ user_id: string; properties: Record<string, unknown> | null; created_at: string }>(
      client,
      'analytics_events',
      'user_id, properties, created_at',
      'user_id',
      ids,
      (q) => q.eq('event_name', 'lesson_completed'),
    ),
    selectForUsers<{ user_id: string; week1_matured: boolean; week1_return: boolean }>(
      client,
      'metric_learner_returns',
      'user_id, week1_matured, week1_return',
      'user_id',
      ids,
    ),
    selectForUsers<{ user_id: string; trial_started_at: string }>(
      client,
      'metric_trial_starts',
      'user_id, trial_started_at',
      'user_id',
      ids,
    ),
    selectForUsers<{ user_id: string }>(client, 'metric_paid_learners', 'user_id', 'user_id', ids),
  ])
  const firstError = lessons.error || returns.error || trials.error || paid.error
  if (firstError) return { data: null, error: firstError }

  const lessonIdsByUser = new Map<string, Set<string>>()
  for (const row of lessons.rows) {
    const uid = String(row.user_id)
    const a = assignment.get(uid)
    if (!a || row.created_at < a.exposedAt) continue
    const lessonId = String(row.properties?.lesson_id ?? row.created_at)
    const set = lessonIdsByUser.get(uid) ?? new Set<string>()
    set.add(lessonId)
    lessonIdsByUser.set(uid, set)
  }
  const returnByUser = new Map(returns.rows.map((r) => [String(r.user_id), r]))
  const trialUsers = new Set(
    trials.rows
      .filter((t) => {
        const a = assignment.get(String(t.user_id))
        return a && t.trial_started_at >= a.exposedAt
      })
      .map((t) => String(t.user_id)),
  )
  const paidUsers = new Set(paid.rows.map((p) => String(p.user_id)))

  const labelByArm = new Map(experiment.arms.map((a) => [a.id, a.label]))
  const byArm = new Map<string, ArmMetricCounts>()
  const blank = (arm: string): ArmMetricCounts => ({
    arm,
    label: labelByArm.get(arm) ?? arm,
    learners: 0,
    l1: 0,
    l2: 0,
    week1Matured: 0,
    week1Returned: 0,
    trial: 0,
    paid: 0,
  })
  for (const a of experiment.arms) byArm.set(a.id, blank(a.id))
  for (const uid of ids) {
    const { arm } = assignment.get(uid)!
    const s = byArm.get(arm) ?? blank(arm)
    byArm.set(arm, s)
    s.learners += 1
    const done = lessonIdsByUser.get(uid)?.size ?? 0
    if (done >= 1) s.l1 += 1
    if (done >= 2) s.l2 += 1
    const r = returnByUser.get(uid)
    if (r?.week1_matured) {
      s.week1Matured += 1
      if (r.week1_return) s.week1Returned += 1
    }
    if (trialUsers.has(uid)) s.trial += 1
    if (paidUsers.has(uid)) s.paid += 1
  }

  const order = experiment.arms.map((a) => a.id)
  const extra = [...byArm.keys()].filter((k) => !order.includes(k)).sort()
  const arms = [...order, ...extra].map((k) => byArm.get(k)!)
  return {
    data: { arms, rows: buildMetricRows(arms), excludedEt, excludedTest, truncated: exposures.truncated },
    error: null,
  }
}
