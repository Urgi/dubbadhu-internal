import { crewAccessToken, clearCrewSession } from './crew'
import { getExpoPublicSupabaseAnonKey, getExpoPublicSupabaseUrl } from './expoPublicEnv'

// Live RevenueCat numbers for Admin → MRR & burn, via Edge Function revenuecat-metrics.
// The RevenueCat secret key stays on the server. The function needs the admin sign-in
// (the same saved session Obsidian Team approvals use), not the service role key.

export type RevenueCatMetric = {
  id: string
  name: string
  unit: string
  period: string
  value: number
  updatedAt: string | null
}

export type DurationCount = { label: string; count: number }

export type RevenueCatOverview = {
  currency: string
  metrics: RevenueCatMetric[]
  /** Active paying subs and trials split by product duration (Monthly / Yearly…). */
  byDuration: { subscriptions: DurationCount[]; trials: DurationCount[] } | null
  breakdownError: string | null
}

export function findMetric(overview: RevenueCatOverview, id: string): RevenueCatMetric | null {
  return overview.metrics.find((m) => m.id === id) ?? null
}

export async function fetchRevenueCatOverview(): Promise<{
  data: RevenueCatOverview | null
  error: string | null
  needsSignIn?: boolean
}> {
  const token = await crewAccessToken()
  if (!token) {
    return { data: null, needsSignIn: true, error: 'Sign out and sign in again to load RevenueCat.' }
  }
  try {
    const res = await fetch(`${getExpoPublicSupabaseUrl()}/functions/v1/revenuecat-metrics`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: getExpoPublicSupabaseAnonKey(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    const body = (await res.json().catch(() => ({}))) as Partial<RevenueCatOverview> & {
      ok?: boolean
      error?: string
    }
    if (res.status === 401) {
      await clearCrewSession()
      return { data: null, needsSignIn: true, error: body.error || 'Sign in again to load RevenueCat.' }
    }
    if (!res.ok || !body.ok) return { data: null, error: body.error || `Request failed (${res.status})` }
    return {
      data: {
        currency: body.currency ?? 'USD',
        metrics: body.metrics ?? [],
        byDuration: body.byDuration ?? null,
        breakdownError: body.breakdownError ?? null,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error.' }
  }
}
