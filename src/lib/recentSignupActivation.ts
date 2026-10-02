import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchRegisteredUsers } from './adminUsers'
import type { AnalyticsCountryScope } from './analyticsEventsQuery'
import { isAnalyticsExcludedUserId } from './analyticsExcludedUsers'

export type RecentSignupFunnelRates = {
  cohortSize: number
  activated: number
  activationPercent: number | null
  activatedThisWeek: number
  premiumConverted: number
  premiumConversionPercent: number | null
  premiumConvertedThisWeek: number
  /** Distinct cohort users with an Expo push token (OS notifications granted + registered). */
  notificationsOn: number
  notificationsOnPercent: number | null
}

/** @deprecated use RecentSignupFunnelRates */
export type RecentSignupActivationRate = {
  cohortSize: number
  activated: number
  percent: number | null
}

type UserPremiumRow = {
  premium_source?: string | null
  premium_product_id?: string | null
  isPremium?: boolean | null
}

function emptyRates(): RecentSignupFunnelRates {
  return {
    cohortSize: 0,
    activated: 0,
    activationPercent: null,
    activatedThisWeek: 0,
    premiumConverted: 0,
    premiumConversionPercent: null,
    premiumConvertedThisWeek: 0,
    notificationsOn: 0,
    notificationsOnPercent: null,
  }
}

/** Cohort users who currently have an Expo push token registered. */
export async function fetchCohortPushTokenUserIds(
  client: SupabaseClient,
  userIds: string[],
): Promise<{ data: string[]; error: string | null }> {
  const ids = userIds.filter((id) => id && !isAnalyticsExcludedUserId(id)).slice(0, 50)
  if (ids.length === 0) return { data: [], error: null }

  const { data, error } = await client.from('push_tokens').select('user_id').in('user_id', ids)
  if (error) return { data: [], error: error.message }

  const on = new Set<string>()
  for (const row of data ?? []) {
    const id = String((row as { user_id?: string }).user_id ?? '')
    if (id) on.add(id)
  }
  return { data: [...on], error: null }
}

/**
 * Real App Store subscriber: active Premium from store with a product SKU.
 * Excludes complimentary, family/excluded IDs, and incomplete store flags (no product_id).
 */
export function isCleanStoreSubscriber(row: UserPremiumRow | null | undefined): boolean {
  if (!row?.isPremium) return false
  if (String(row.premium_source || '').trim().toLowerCase() !== 'store') return false
  const product = row.premium_product_id != null ? String(row.premium_product_id).trim() : ''
  return product.length > 0
}

export type CohortFirstEvent = { userId: string; firstAt: string }

/**
 * Distinct learners with any analytics event since `windowMs` ago (default 30 min).
 * Uses `admin_count_users_active_since` — live “active now / online” count.
 */
export async function fetchUsersOnlineNow(
  client: SupabaseClient,
  windowMs = 30 * 60 * 1000,
  countryScope: AnalyticsCountryScope = 'all',
): Promise<{ data: number | null; error: string | null }> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const { data, error } = await client.rpc('admin_count_users_active_since', {
    p_since: since,
    p_country_scope: countryScope,
  })
  if (error) return { data: null, error: error.message }
  return { data: Number(data ?? 0), error: null }
}

/** First `event_name` timestamp per id — not the global newest-N events feed. */
export async function fetchCohortFirstEventAt(
  client: SupabaseClient,
  userIds: string[],
  eventName: string,
): Promise<{ data: CohortFirstEvent[]; error: string | null }> {
  const ids = userIds.filter((id) => id && !isAnalyticsExcludedUserId(id)).slice(0, 50)
  if (ids.length === 0) return { data: [], error: null }

  const { data, error } = await client.rpc('admin_cohort_first_event_at', {
    p_user_ids: ids,
    p_event_name: eventName,
  })
  if (error) return { data: [], error: error.message }

  const rows = (data ?? []) as Array<{ user_id?: string; first_at?: string }>
  return {
    data: rows
      .map((row) => ({
        userId: String(row.user_id ?? ''),
        firstAt: String(row.first_at ?? ''),
      }))
      .filter((row) => row.userId && row.firstAt),
    error: null,
  }
}

/**
 * Activation + paid premium + notification opt-in among the newest registered learners (max 50).
 * - Activated = `activation_complete` for those user IDs (index on user_id, event_name)
 * - Premium = currently a clean store subscriber (isPremium + store + product_id)
 * - Premium this week = clean store sub who also has `premium_purchased` in the last 7 days
 * - Notifications on = has a row in `push_tokens` (OS grant + Expo registration)
 * Pass `non_et` for store conversion (ET does not see the paywall).
 */
export async function fetchRecentSignupFunnelRates(
  client: SupabaseClient,
  limit = 50,
  countryScope: AnalyticsCountryScope = 'all',
): Promise<{ data: RecentSignupFunnelRates | null; error: string | null }> {
  const capped = Math.max(1, Math.min(limit, 50))
  const weekAgoMs = Date.now() - 7 * 86400000
  const usersRes = await fetchRegisteredUsers(capped, countryScope)
  if (usersRes.error) return { data: null, error: usersRes.error }

  const users = (usersRes.data ?? []).slice(0, capped)
  if (users.length === 0) {
    return { data: emptyRates(), error: null }
  }

  const userIds = users.map((u) => u.id)
  const [activatedRes, purchasedRes, pushRes] = await Promise.all([
    fetchCohortFirstEventAt(client, userIds, 'activation_complete'),
    fetchCohortFirstEventAt(client, userIds, 'premium_purchased'),
    fetchCohortPushTokenUserIds(client, userIds),
  ])

  const eventsError = activatedRes.error || purchasedRes.error || pushRes.error
  const activated = new Set(activatedRes.data.map((row) => row.userId))
  const activatedThisWeek = new Set(
    activatedRes.data
      .filter((row) => {
        const at = new Date(row.firstAt).getTime()
        return Number.isFinite(at) && at >= weekAgoMs
      })
      .map((row) => row.userId),
  )
  const purchasedThisWeek = new Set(
    purchasedRes.data
      .filter((row) => {
        const at = new Date(row.firstAt).getTime()
        return Number.isFinite(at) && at >= weekAgoMs
      })
      .map((row) => row.userId),
  )

  const premium = new Set<string>()
  const premiumThisWeek = new Set<string>()
  for (const user of users) {
    if (isAnalyticsExcludedUserId(user.id)) continue
    const { data, error } = await client.rpc('admin_find_user_by_id', { p_user_id: user.id })
    if (error) continue
    const row = (Array.isArray(data) ? data[0] : data) as UserPremiumRow | undefined
    if (!isCleanStoreSubscriber(row)) continue
    premium.add(user.id)
    if (purchasedThisWeek.has(user.id)) premiumThisWeek.add(user.id)
  }

  const notificationsOn = pushRes.data.length
  const cohortSize = users.length
  return {
    data: {
      cohortSize,
      activated: activated.size,
      activationPercent: cohortSize > 0 ? (activated.size / cohortSize) * 100 : null,
      activatedThisWeek: activatedThisWeek.size,
      premiumConverted: premium.size,
      premiumConversionPercent: cohortSize > 0 ? (premium.size / cohortSize) * 100 : null,
      premiumConvertedThisWeek: premiumThisWeek.size,
      notificationsOn,
      notificationsOnPercent: cohortSize > 0 ? (notificationsOn / cohortSize) * 100 : null,
    },
    error: eventsError,
  }
}

/** Back-compat wrapper for activation-only callers. */
export async function fetchRecentSignupActivationRate(
  client: SupabaseClient,
  limit = 50,
): Promise<{ data: RecentSignupActivationRate | null; error: string | null }> {
  const res = await fetchRecentSignupFunnelRates(client, limit)
  if (!res.data) return { data: null, error: res.error }
  return {
    data: {
      cohortSize: res.data.cohortSize,
      activated: res.data.activated,
      percent: res.data.activationPercent,
    },
    error: res.error,
  }
}
