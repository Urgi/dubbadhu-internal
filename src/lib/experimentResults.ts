import type { SupabaseClient } from '@supabase/supabase-js'
import { isAnalyticsExcludedUserId } from './analyticsExcludedUsers'
import { APP_CONFIG_ROW_ID, type KnownExperiment } from './experiments'

export type ExperimentDateRange = '7d' | '30d' | 'all'

/** Same buckets as Admin Analytics: +251 is ET; everyone else, including a missing phone, is NET. */
export type ExperimentCountryScope = 'all' | 'non_et' | 'et'

export type ExperimentEventRow = {
  user_id: string | null
  event_name: string
  properties: Record<string, unknown> | null
  created_at: string
}

export type ExperimentArmStats = {
  arm: string
  label: string
  exposures: number
  uniqueUsers: number
  lessonsCompleted: number
  paywallViewed: number
  premiumPurchased: number
}

export type ExperimentResults = {
  range: ExperimentDateRange
  sinceIso: string | null
  untilIso: string
  exposureEventName: string
  sawPaywallEvent: boolean
  sawPremiumEvent: boolean
  totalExposures: number
  totalUniqueUsers: number
  arms: ExperimentArmStats[]
  truncated: boolean
}

const FETCH_PAGE_SIZE = 1000
const FETCH_CAP = 20_000

/** Verified in prod: learner emits `experiment_exposed`. Accept the alias if it appears. */
export const EXPERIMENT_EXPOSURE_EVENT_NAMES = ['experiment_exposed', 'experiment_exposure'] as const

const FUNNEL_EVENT_NAMES = ['lesson_completed', 'paywall_viewed', 'premium_purchased'] as const

const FETCH_EVENT_NAMES = [...EXPERIMENT_EXPOSURE_EVENT_NAMES, ...FUNNEL_EVENT_NAMES]

const EXPOSURE_NAME_SET = new Set<string>(EXPERIMENT_EXPOSURE_EVENT_NAMES)

export function phoneIsEthiopia(phone: string | null | undefined): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.startsWith('251')
}

export function userMatchesExperimentCountry(
  phone: string | null | undefined,
  scope: ExperimentCountryScope,
): boolean {
  if (scope === 'all') return true
  const et = phoneIsEthiopia(phone)
  return scope === 'et' ? et : !et
}

export function sinceIsoForRange(range: ExperimentDateRange, nowMs = Date.now()): string | null {
  if (range === 'all') return null
  const days = range === '7d' ? 7 : 30
  return new Date(nowMs - days * 86400000).toISOString()
}

function strProp(properties: Record<string, unknown> | null, ...keys: string[]): string {
  if (!properties) return ''
  for (const key of keys) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function isExposureEvent(eventName: string): boolean {
  return EXPOSURE_NAME_SET.has(String(eventName || '').trim())
}

export function eventExperimentKey(properties: Record<string, unknown> | null): string {
  return strProp(properties, 'experiment_key', 'experiment_id')
}

export function eventArm(
  properties: Record<string, unknown> | null,
  experimentKey?: string,
): string {
  const key = experimentKey || eventExperimentKey(properties)
  if (key === 'mic_skip_v1') return strProp(properties, 'mic_skip_arm')
  if (key === 'timed_comments_v1') return strProp(properties, 'timed_comments_arm')
  if (key === 'series_intro_translation_v1') {
    return strProp(properties, 'series_intro_arm', 'intro_variant', 'arm', 'variant')
  }
  if (key === 'paywall_free_n_v1') return strProp(properties, 'arm')
  return strProp(properties, 'arm', 'variant', 'bucket')
}

export function emptyResults(
  experiment: KnownExperiment,
  range: ExperimentDateRange,
  nowMs = Date.now(),
): ExperimentResults {
  return {
    range,
    sinceIso: sinceIsoForRange(range, nowMs),
    untilIso: new Date(nowMs).toISOString(),
    exposureEventName: 'experiment_exposed',
    sawPaywallEvent: false,
    sawPremiumEvent: false,
    totalExposures: 0,
    totalUniqueUsers: 0,
    arms: experiment.arms.map((arm) => ({
      arm: arm.id,
      label: arm.label,
      exposures: 0,
      uniqueUsers: 0,
      lessonsCompleted: 0,
      paywallViewed: 0,
      premiumPurchased: 0,
    })),
    truncated: false,
  }
}

function rateEligible(count: number, uniqueUsers: number): string {
  if (uniqueUsers <= 0) return '—'
  const pct = (count / uniqueUsers) * 100
  return `${count} / ${uniqueUsers} (${pct.toFixed(0)}%)`
}

export function formatArmRate(
  stats: ExperimentArmStats,
  kind: 'lessons' | 'paywall' | 'premium',
): string {
  const count =
    kind === 'lessons'
      ? stats.lessonsCompleted
      : kind === 'paywall'
        ? stats.paywallViewed
        : stats.premiumPurchased
  return rateEligible(count, stats.uniqueUsers)
}

/**
 * First exposure in-window assigns the arm (sticky). Funnel events after that
 * timestamp count toward the arm. Unknown arms still appear so we don't hide data.
 */
export function aggregateExperimentResults(
  experiment: KnownExperiment,
  rows: ExperimentEventRow[],
  excludedUserIds: Set<string>,
  range: ExperimentDateRange,
  nowMs = Date.now(),
  truncated = false,
  country: {
    scope?: ExperimentCountryScope
    phoneByUserId?: Map<string, string | null>
  } = {},
): ExperimentResults {
  const result = emptyResults(experiment, range, nowMs)
  const labelByArm = new Map(experiment.arms.map((a) => [a.id, a.label]))
  const statsByArm = new Map(result.arms.map((a) => [a.arm, a]))

  const sorted = [...rows].sort((a, b) => {
    const at = a.created_at || ''
    const bt = b.created_at || ''
    if (at !== bt) return at < bt ? -1 : 1
    return String(a.event_name).localeCompare(String(b.event_name))
  })

  const assignment = new Map<string, { arm: string; exposedAt: string }>()
  let exposureName = 'experiment_exposed'
  const scope = country.scope === 'et' || country.scope === 'non_et' ? country.scope : 'all'
  const phoneByUserId = country.phoneByUserId

  for (const row of sorted) {
    const uid = row.user_id == null ? '' : String(row.user_id)
    if (!uid || excludedUserIds.has(uid) || isAnalyticsExcludedUserId(uid)) continue
    if (
      scope !== 'all' &&
      !userMatchesExperimentCountry(phoneByUserId?.get(uid) ?? '', scope)
    ) {
      continue
    }
    if (!isExposureEvent(row.event_name)) continue
    if (eventExperimentKey(row.properties) !== experiment.key) continue
    const arm = eventArm(row.properties, experiment.key)
    if (!arm) continue
    if (row.event_name === 'experiment_exposed') exposureName = 'experiment_exposed'
    else if (exposureName !== 'experiment_exposed') exposureName = row.event_name

    const existing = assignment.get(uid)
    const assignedArm = existing?.arm ?? arm
    let stats = statsByArm.get(assignedArm)
    if (!stats) {
      stats = {
        arm: assignedArm,
        label: labelByArm.get(assignedArm) ?? assignedArm,
        exposures: 0,
        uniqueUsers: 0,
        lessonsCompleted: 0,
        paywallViewed: 0,
        premiumPurchased: 0,
      }
      statsByArm.set(assignedArm, stats)
    }
    stats.exposures += 1
    result.totalExposures += 1
    if (!existing) {
      assignment.set(uid, { arm, exposedAt: row.created_at })
      stats.uniqueUsers += 1
      result.totalUniqueUsers += 1
    }
  }

  const paywalled = new Set<string>()
  const purchased = new Set<string>()

  for (const row of sorted) {
    const uid = row.user_id == null ? '' : String(row.user_id)
    if (!uid) continue
    const assigned = assignment.get(uid)
    if (!assigned) continue
    if (row.created_at && assigned.exposedAt && row.created_at < assigned.exposedAt) continue
    const stats = statsByArm.get(assigned.arm)
    if (!stats) continue
    if (row.event_name === 'lesson_completed') {
      stats.lessonsCompleted += 1
    } else if (row.event_name === 'paywall_viewed') {
      result.sawPaywallEvent = true
      if (!paywalled.has(uid)) {
        paywalled.add(uid)
        stats.paywallViewed += 1
      }
    } else if (row.event_name === 'premium_purchased') {
      result.sawPremiumEvent = true
      if (!purchased.has(uid)) {
        purchased.add(uid)
        stats.premiumPurchased += 1
      }
    }
  }

  const knownOrder = experiment.arms.map((a) => a.id)
  const extra = [...statsByArm.keys()].filter((id) => !knownOrder.includes(id)).sort()
  result.arms = [...knownOrder, ...extra].map((id) => statsByArm.get(id)!).filter(Boolean)
  result.exposureEventName = exposureName
  result.truncated = truncated
  return result
}

async function fetchDbExcludedUserIds(client: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>()
  let offset = 0
  while (offset < FETCH_CAP) {
    const { data, error } = await client
      .from('users')
      .select('id')
      .eq('exclude_from_analytics', true)
      .range(offset, offset + FETCH_PAGE_SIZE - 1)
    if (error) {
      // Column / RLS not joinable — caller still applies the hardcoded Internal exclude list.
      return ids
    }
    const batch = (data ?? []) as Array<{ id: string }>
    for (const row of batch) {
      if (row?.id) ids.add(String(row.id))
    }
    if (batch.length < FETCH_PAGE_SIZE) break
    offset += batch.length
  }
  return ids
}

function normalizeEventRow(raw: Record<string, unknown>): ExperimentEventRow {
  return {
    user_id: raw.user_id == null ? null : String(raw.user_id),
    event_name: String(raw.event_name ?? ''),
    properties: (raw.properties as Record<string, unknown> | null) ?? null,
    created_at: String(raw.created_at ?? ''),
  }
}

async function fetchEventsDirect(
  client: SupabaseClient,
  sinceIso: string | null,
): Promise<{ data: ExperimentEventRow[]; error: string | null; truncated: boolean }> {
  const rows: ExperimentEventRow[] = []
  let offset = 0
  while (offset < FETCH_CAP) {
    let query = client
      .from('analytics_events')
      .select('user_id, event_name, properties, created_at')
      .in('event_name', FETCH_EVENT_NAMES)
      .order('created_at', { ascending: true })
      .range(offset, offset + FETCH_PAGE_SIZE - 1)
    if (sinceIso) query = query.gte('created_at', sinceIso)
    const { data, error } = await query
    if (error) return { data: rows, error: error.message, truncated: false }
    const batch = ((data ?? []) as Record<string, unknown>[]).map(normalizeEventRow)
    rows.push(...batch)
    if (batch.length < FETCH_PAGE_SIZE) return { data: rows, error: null, truncated: false }
    offset += batch.length
  }
  return { data: rows, error: null, truncated: true }
}

async function fetchEventsViaAdminRpc(
  client: SupabaseClient,
  sinceIso: string | null,
): Promise<{ data: ExperimentEventRow[]; error: string | null; truncated: boolean }> {
  const rows: ExperimentEventRow[] = []
  let offset = 0
  const wanted = new Set<string>(FETCH_EVENT_NAMES)
  while (offset < FETCH_CAP) {
    const { data, error } = await client.rpc('admin_fetch_analytics_events', {
      p_since: sinceIso,
      p_limit: FETCH_PAGE_SIZE,
      p_offset: offset,
    })
    if (error) return { data: rows, error: error.message, truncated: false }
    const batch = ((data ?? []) as Record<string, unknown>[]).map(normalizeEventRow)
    if (batch.length === 0) break
    for (const row of batch) {
      if (wanted.has(row.event_name)) rows.push(row)
    }
    if (batch.length < FETCH_PAGE_SIZE) {
      return { data: rows, error: null, truncated: false }
    }
    offset += batch.length
  }
  return { data: rows, error: null, truncated: offset >= FETCH_CAP }
}

async function fetchPhonesByUserId(
  client: SupabaseClient,
  userIds: string[],
): Promise<{ phones: Map<string, string | null>; error: string | null }> {
  const phones = new Map<string, string | null>()
  const unique = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const chunkSize = 150
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const { data, error } = await client.from('users').select('id, phone').in('id', chunk)
    if (error) return { phones, error: error.message }
    for (const row of (data ?? []) as Array<{ id?: string; phone?: string | null }>) {
      if (!row?.id) continue
      phones.set(String(row.id), row.phone == null ? '' : String(row.phone))
    }
  }
  return { phones, error: null }
}

export async function fetchExperimentResults(
  client: SupabaseClient,
  experiment: KnownExperiment,
  range: ExperimentDateRange,
  countryScope: ExperimentCountryScope = 'all',
): Promise<{ data: ExperimentResults; error: string | null }> {
  const nowMs = Date.now()
  const sinceIso = sinceIsoForRange(range, nowMs)
  const scope = countryScope === 'et' || countryScope === 'non_et' ? countryScope : 'all'
  const excluded = await fetchDbExcludedUserIds(client)

  const direct = await fetchEventsDirect(client, sinceIso)
  const fetched = direct.error ? await fetchEventsViaAdminRpc(client, sinceIso) : direct
  if (fetched.error && fetched.data.length === 0) {
    return { data: emptyResults(experiment, range, nowMs), error: fetched.error }
  }

  let phoneByUserId: Map<string, string | null> | undefined
  if (scope !== 'all') {
    const userIds = fetched.data.map((row) => (row.user_id == null ? '' : String(row.user_id)))
    const phones = await fetchPhonesByUserId(client, userIds)
    if (phones.error) {
      return { data: emptyResults(experiment, range, nowMs), error: phones.error }
    }
    phoneByUserId = phones.phones
  }

  return {
    data: aggregateExperimentResults(
      experiment,
      fetched.data,
      excluded,
      range,
      nowMs,
      fetched.truncated,
      { scope, phoneByUserId },
    ),
    error: fetched.error,
  }
}

export async function fetchExperimentFlag(
  client: SupabaseClient,
  flagColumn: KnownExperiment['flagColumn'],
): Promise<{ enabled: boolean; updatedAt: string | null; error: string | null }> {
  if (!flagColumn) {
    return { enabled: true, updatedAt: null, error: null }
  }
  const { data, error } = await client
    .from('app_config')
    .select(`${flagColumn}, updated_at`)
    .eq('id', APP_CONFIG_ROW_ID)
    .maybeSingle()
  if (error) return { enabled: false, updatedAt: null, error: error.message }
  const row = data as Record<string, unknown> | null
  return {
    enabled: Boolean(row?.[flagColumn]),
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
    error: null,
  }
}

/** Upsert only `id` + the experiment flag so other app_config fields are not clobbered. */
export async function upsertExperimentFlag(
  client: SupabaseClient,
  flagColumn: KnownExperiment['flagColumn'],
  enabled: boolean,
): Promise<{ error: string | null }> {
  if (!flagColumn) return { error: 'This experiment has no kill switch' }
  const { error } = await client.from('app_config').upsert(
    {
      id: APP_CONFIG_ROW_ID,
      [flagColumn]: enabled,
    },
    { onConflict: 'id' },
  )
  return { error: error?.message ?? null }
}
