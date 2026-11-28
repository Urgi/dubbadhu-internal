import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Admin home "This week" numbers from the shared metric views (prod 20261126130000_metric_definitions.sql).
 * Weeks are UTC, Monday to Sunday. "This week" is Monday → today; it's compared with the same days last week.
 * Week-1 return is per signup week and only for the newest week whose learners all had their days 7–13.
 */

export type WeekCompare = { now: number; prev: number }

export type WeeklyMetrics = {
  weekStart: string
  daysSoFar: number
  signups: WeekCompare
  trials: WeekCompare
  /** Week-1 return for the newest matured signup week vs the week before. */
  week1: { cohortStart: string; returned: number; base: number; prevReturned: number; prevBase: number } | null
  paidTotal: number
  paidActive: number
}

const DAY = 86400000

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Monday 00:00 UTC of the week containing `ms`. */
export function mondayUtc(ms: number): number {
  const d = new Date(ms)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const dow = (new Date(start).getUTCDay() + 6) % 7 // Mon=0
  return start - dow * DAY
}

/** Newest Monday whose whole week is matured for week-1 return (every signup day ≤ today − 14). */
export function newestMaturedCohortMonday(nowMs: number): number {
  const today = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate())
  // Sunday of the cohort week must be ≤ today − 14 (the view's week1_matured is current_date > signup_day + 13).
  const lastMaturedDay = today - 14 * DAY
  const mon = mondayUtc(lastMaturedDay)
  return mon + 6 * DAY <= lastMaturedDay ? mon : mon - 7 * DAY
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await q
  if (error) throw new Error(error.message)
  return n ?? 0
}

export async function fetchWeeklyMetrics(
  client: SupabaseClient,
  nowMs = Date.now(),
): Promise<{ data: WeeklyMetrics | null; error: string | null }> {
  try {
    const thisMon = mondayUtc(nowMs)
    const today = utcDay(nowMs)
    const daysSoFar = Math.floor((Date.parse(today) - thisMon) / DAY) + 1
    const prevMon = thisMon - 7 * DAY
    const prevEndExcl = prevMon + daysSoFar * DAY // same days last week
    const iso = (ms: number) => new Date(ms).toISOString()

    const head = { count: 'exact' as const, head: true }
    const cohortMon = newestMaturedCohortMonday(nowMs)
    const cohort = (mon: number) =>
      client
        .from('metric_learner_returns')
        .select('week1_return')
        .eq('week1_matured', true)
        .gte('signup_day', utcDay(mon))
        .lt('signup_day', utcDay(mon + 7 * DAY))

    const [signupsNow, signupsPrev, trialsNow, trialsPrev, paidTotal, paidActive, cohortNow, cohortPrev] =
      await Promise.all([
        count(client.from('metric_signups').select('user_id', head).gte('signed_up_at', iso(thisMon))),
        count(
          client
            .from('metric_signups')
            .select('user_id', head)
            .gte('signed_up_at', iso(prevMon))
            .lt('signed_up_at', iso(prevEndExcl)),
        ),
        count(client.from('metric_trial_starts').select('user_id', head).gte('trial_started_at', iso(thisMon))),
        count(
          client
            .from('metric_trial_starts')
            .select('user_id', head)
            .gte('trial_started_at', iso(prevMon))
            .lt('trial_started_at', iso(prevEndExcl)),
        ),
        count(client.from('metric_paid_learners').select('user_id', head)),
        count(client.from('metric_paid_learners').select('user_id', head).eq('premium_now', true)),
        cohort(cohortMon),
        cohort(cohortMon - 7 * DAY),
      ])
    if (cohortNow.error) throw new Error(cohortNow.error.message)
    if (cohortPrev.error) throw new Error(cohortPrev.error.message)
    const rowsNow = (cohortNow.data ?? []) as { week1_return: boolean }[]
    const rowsPrev = (cohortPrev.data ?? []) as { week1_return: boolean }[]

    return {
      data: {
        weekStart: utcDay(thisMon),
        daysSoFar,
        signups: { now: signupsNow, prev: signupsPrev },
        trials: { now: trialsNow, prev: trialsPrev },
        week1: {
          cohortStart: utcDay(cohortMon),
          returned: rowsNow.filter((r) => r.week1_return).length,
          base: rowsNow.length,
          prevReturned: rowsPrev.filter((r) => r.week1_return).length,
          prevBase: rowsPrev.length,
        },
        paidTotal,
        paidActive,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
