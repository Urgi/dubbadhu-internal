import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchActiveUsersToday,
  fetchRegisteredUsers,
  type AdminRegisteredUserRow,
} from './adminUsers'
import type { AnalyticsCountryScope } from './analyticsEventsQuery'
import { isAnalyticsExcludedUserId } from './analyticsExcludedUsers'
import {
  fetchDeviceInfoForUserIds,
  type AdminDevicePlatform,
} from './adminDevicePlatform'
import {
  fetchCohortFirstEventAt,
  fetchCohortPremiumRows,
  fetchCohortPushTokenUserIds,
  isCleanStoreSubscriber,
} from './recentSignupActivation'
import supabase from './supabase'

export type AdminUsersListMode =
  | 'registered'
  | 'activeToday'
  | 'activeNow'
  | 'notifications'
  | 'activated'
  | 'premium'

export type AdminCohortUserRow = AdminRegisteredUserRow & {
  platform?: AdminDevicePlatform | null
  app_version?: string | null
  qualify_note?: string | null
}

function normalizeScope(scope?: AnalyticsCountryScope | null): AnalyticsCountryScope {
  return scope === 'et' || scope === 'non_et' ? scope : 'all'
}

async function attachDeviceInfo(rows: AdminRegisteredUserRow[]): Promise<AdminCohortUserRow[]> {
  if (rows.length === 0) return []
  const info = await fetchDeviceInfoForUserIds(
    supabase,
    rows.map((r) => r.id),
  )
  return rows.map((row) => {
    const d = info.get(row.id)
    return {
      ...row,
      platform: d?.platform ?? null,
      app_version: d?.appVersion ?? null,
    }
  })
}

async function fetchUsersByIdsOrdered(
  client: SupabaseClient,
  orderedIds: string[],
): Promise<AdminRegisteredUserRow[]> {
  const ids = orderedIds.filter((id) => id && !isAnalyticsExcludedUserId(id)).slice(0, 50)
  if (ids.length === 0) return []

  const { data, error } = await client
    .from('users')
    .select(
      'id, phone, first_name, last_name, current_streak, longest_streak, last_activity_date, created_at',
    )
    .in('id', ids)

  if (error || !data) return []

  const byId = new Map<string, AdminRegisteredUserRow>()
  for (const raw of data as AdminRegisteredUserRow[]) {
    byId.set(String(raw.id), {
      id: String(raw.id),
      phone: raw.phone ?? null,
      first_name: raw.first_name ?? null,
      last_name: raw.last_name ?? null,
      current_streak: Number(raw.current_streak ?? 0),
      longest_streak: Number(raw.longest_streak ?? 0),
      last_activity_date: raw.last_activity_date ?? null,
      created_at: String(raw.created_at ?? ''),
    })
  }

  return ids.map((id) => byId.get(id)).filter(Boolean) as AdminRegisteredUserRow[]
}

/** Distinct users with any analytics event in the last `windowMs` (default 30 min). */
export async function fetchActiveUsersNow(
  limit = 20,
  countryScope: AnalyticsCountryScope = 'all',
  windowMs = 30 * 60 * 1000,
): Promise<{ data: AdminCohortUserRow[] | null; error: string | null }> {
  const capped = Math.max(1, Math.min(limit, 50))
  const scope = normalizeScope(countryScope)
  const since = new Date(Date.now() - windowMs).toISOString()

  const { data, error } = await supabase.rpc('admin_fetch_analytics_events', {
    p_since: since,
    p_limit: 500,
    p_offset: 0,
    p_country_scope: scope,
  })
  if (error) return { data: null, error: error.message }

  const orderedIds: string[] = []
  const seen = new Set<string>()
  const lastAt = new Map<string, string>()
  for (const raw of (data ?? []) as Array<{ user_id?: string; created_at?: string }>) {
    const id = raw.user_id == null ? '' : String(raw.user_id)
    if (!id || isAnalyticsExcludedUserId(id) || seen.has(id)) continue
    seen.add(id)
    orderedIds.push(id)
    lastAt.set(id, String(raw.created_at ?? ''))
    if (orderedIds.length >= capped) break
  }

  const users = await fetchUsersByIdsOrdered(supabase, orderedIds)
  const withLast = users.map((u) => ({
    ...u,
    last_event_at: lastAt.get(u.id) ?? null,
    qualify_note: 'Active in last 30 min',
  }))
  return { data: await attachDeviceInfo(withLast), error: null }
}

type Last50Ctx = {
  activated: Set<string>
  pushOn: Set<string>
  premium: Set<string>
}

async function fetchLast50Cohort(
  countryScope: AnalyticsCountryScope,
  options: {
    /** If set, only include users matching this predicate (activation list). */
    onlyMatching?: (user: AdminRegisteredUserRow, ctx: Last50Ctx) => boolean
    noteFor: (user: AdminRegisteredUserRow, ctx: Last50Ctx) => string
  },
): Promise<{ data: AdminCohortUserRow[] | null; error: string | null }> {
  const usersRes = await fetchRegisteredUsers(50, countryScope)
  if (usersRes.error) return { data: null, error: usersRes.error }
  const users = usersRes.data ?? []
  if (users.length === 0) return { data: [], error: null }

  const userIds = users.map((u) => u.id)
  const [activatedRes, pushRes, premiumRes] = await Promise.all([
    fetchCohortFirstEventAt(supabase, userIds, 'activation_complete'),
    fetchCohortPushTokenUserIds(supabase, userIds),
    fetchCohortPremiumRows(supabase, userIds),
  ])

  const activated = new Set(activatedRes.data.map((r) => r.userId))
  const pushOn = new Set(pushRes.data)
  const premium = new Set<string>()
  for (const id of userIds) {
    if (isCleanStoreSubscriber(premiumRes.data.get(id))) premium.add(id)
  }
  const ctx: Last50Ctx = { activated, pushOn, premium }

  const selected = options.onlyMatching
    ? users.filter((u) => options.onlyMatching!(u, ctx))
    : users

  const rows = selected.map((u) => ({ ...u, qualify_note: options.noteFor(u, ctx) }))
  return { data: await attachDeviceInfo(rows), error: null }
}

export async function fetchAnalyticsCohortUsers(
  mode: AdminUsersListMode,
  countryScope: AnalyticsCountryScope = 'all',
): Promise<{ data: AdminCohortUserRow[] | null; error: string | null }> {
  const scope = normalizeScope(countryScope)

  if (mode === 'registered') {
    const res = await fetchRegisteredUsers(200, scope)
    if (res.error) return { data: null, error: res.error }
    return { data: await attachDeviceInfo(res.data ?? []), error: null }
  }

  if (mode === 'activeToday') {
    const res = await fetchActiveUsersToday(10, scope)
    if (res.error) return { data: null, error: res.error }
    const rows = (res.data ?? []).map((u) => ({
      ...u,
      qualify_note: 'Active today (Pacific)',
    }))
    return { data: await attachDeviceInfo(rows), error: null }
  }

  if (mode === 'activeNow') {
    return fetchActiveUsersNow(20, scope)
  }

  if (mode === 'notifications') {
    // Full last-50 cohort; note who has push on.
    return fetchLast50Cohort(scope, {
      noteFor: (u, ctx) => (ctx.pushOn.has(u.id) ? 'Push on' : 'No push'),
    })
  }

  if (mode === 'activated') {
    // Activation is the exception — only people who activated.
    return fetchLast50Cohort(scope, {
      onlyMatching: (u, ctx) => ctx.activated.has(u.id),
      noteFor: () => 'activation_complete',
    })
  }

  // Premium is always non-ET (paywall cohort). Full last-50 non-ET list.
  return fetchLast50Cohort('non_et', {
    noteFor: (u, ctx) => (ctx.premium.has(u.id) ? 'Store Premium' : 'Not premium'),
  })
}

export function adminUsersModeTitle(mode: AdminUsersListMode): string {
  switch (mode) {
    case 'activeToday':
      return 'Active today'
    case 'activeNow':
      return 'Active now'
    case 'notifications':
      return 'Notifications on'
    case 'activated':
      return 'Activated'
    case 'premium':
      return 'Premium (non-ET)'
    default:
      return 'Registered users'
  }
}

export function adminUsersModeLead(mode: AdminUsersListMode, scopeLabel: string | null): string {
  const scopeBit = scopeLabel ? ` Filtered to ${scopeLabel}.` : ''
  switch (mode) {
    case 'activeToday':
      return `Users with analytics activity today (Pacific). Most recent first, max 10.${scopeBit}`
    case 'activeNow':
      return `Users with any analytics event in the last 30 minutes. Most recent first.${scopeBit}`
    case 'notifications':
      return `Newest 50 signups. Each row shows whether push is on.${scopeBit}`
    case 'activated':
      return `Among the newest 50 signups, only users who fired activation_complete.${scopeBit}`
    case 'premium':
      return 'Newest 50 non-ET signups (always non-ET). Each row shows store Premium vs not.'
    default:
      return `Name, streak, top streak, and last login. Newest first.${scopeBit}`
  }
}
