/**
 * Admin metric colors vs top consumer LL (Duolingo public metrics, Q2 2026):
 * DAU 58.7M · MAU 140.6M · DAU/MAU ~42% · paid 12.7M · paid/MAU ~9%.
 *
 * Green  = beating that competitor band
 * White  = in range
 * Red    = below
 *
 * Our cards are not the same definition as Duo’s 10-Q. We map the closest public number:
 * - Active today = DAU / lifetime registered (Duo does not publish this; implied DAU/lifetime ~5–7%)
 * - Activation = last-50 first-lesson (industry first-value ~40–60%; Duo does not publish L1 %)
 * - Premium = last-50 non-ET clean store / Duo paid-of-MAU ~9%
 * - Notifications = last-50 with Expo push_tokens (mobile push opt-in often ~35–55%)
 */

export type MetricTone = 'good' | 'neutral' | 'bad'

export const METRIC_TONE_COLOR: Record<MetricTone, string> = {
  good: '#30d158',
  neutral: '#ffffff',
  bad: '#ff453a',
}

/** Last-≤50 first-lesson. Industry first-value ~40–60%; green beats the mid/top of that band. */
export const ACTIVATION_PCT_GOOD = 50
export const ACTIVATION_PCT_OK = 40

/** Last-≤50 non-ET clean store vs Duolingo paid/MAU ~9%. */
export const PREMIUM_PCT_GOOD = 10
export const PREMIUM_PCT_OK = 6

/** Last-≤50 with an Expo push token (OS notifications granted + registered). */
export const NOTIFICATIONS_PCT_GOOD = 50
export const NOTIFICATIONS_PCT_OK = 35

/**
 * Weekly paid conversions on an early path to ~300 paid/mo by month 6.
 * ~6+/week ≈ month-1 pace; 1–5 is building; 0 with signups is a miss.
 */
export const PREMIUM_WEEKLY_GOOD = 6
export const PREMIUM_WEEKLY_OK = 1

/** Weekly activations vs new signups — same first-value band as last-50 activation. */
export const ACTIVATION_WEEKLY_VS_SIGNUPS_GOOD = 0.5

/**
 * Weekly new signups (month 1).
 * At ~+4/week you barely crawl toward an 80–200 registered base.
 * ≥15/week ≈ on pace to build that base in the first 1–2 months.
 */
export const REGISTERED_WEEKLY_GOOD = 15
export const REGISTERED_WEEKLY_OK = 1

export function toneForWeeklyRegisteredDelta(n: number | null | undefined): MetricTone {
  if (n == null || !Number.isFinite(n)) return 'neutral'
  if (n < 0) return 'bad'
  if (n >= REGISTERED_WEEKLY_GOOD) return 'good'
  if (n >= REGISTERED_WEEKLY_OK) return 'neutral'
  return 'neutral'
}

export function toneForWeeklyActivationDelta(
  activatedThisWeek: number | null | undefined,
  signupsThisWeek: number | null | undefined,
): MetricTone {
  const a = activatedThisWeek ?? 0
  const s = signupsThisWeek ?? 0
  if (!Number.isFinite(a)) return 'neutral'
  if (a < 0) return 'bad'
  if (s > 0 && a === 0) return 'bad'
  if (s > 0) {
    const ratio = a / s
    if (ratio >= ACTIVATION_WEEKLY_VS_SIGNUPS_GOOD) return 'good'
    if (a > 0) return 'neutral'
    return 'bad'
  }
  // No new signups this week: any activation is still good (older cohort catching up).
  if (a > 0) return 'good'
  return 'neutral'
}

export function toneForWeeklyPremiumDelta(
  paidThisWeek: number | null | undefined,
  signupsThisWeek: number | null | undefined,
): MetricTone {
  const p = paidThisWeek ?? 0
  const s = signupsThisWeek ?? 0
  if (!Number.isFinite(p)) return 'neutral'
  if (p < 0) return 'bad'
  if (p >= PREMIUM_WEEKLY_GOOD) return 'good'
  if (p >= PREMIUM_WEEKLY_OK) return 'neutral'
  if (s > 0 && p === 0) return 'bad'
  return 'neutral'
}

export function toneForActivationPercent(pct: number | null | undefined): MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (pct >= ACTIVATION_PCT_GOOD) return 'good'
  if (pct < ACTIVATION_PCT_OK) return 'bad'
  return 'neutral'
}

export function toneForNotificationsPercent(pct: number | null | undefined): MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (pct >= NOTIFICATIONS_PCT_GOOD) return 'good'
  if (pct < NOTIFICATIONS_PCT_OK) return 'bad'
  return 'neutral'
}

export function toneForPremiumPercent(pct: number | null | undefined): MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (pct >= PREMIUM_PCT_GOOD) return 'good'
  if (pct < PREMIUM_PCT_OK) return 'bad'
  return 'neutral'
}

/** DAU / lifetime registered vs implied Duolingo DAU/lifetime (~5–7%). */
export const ACTIVE_TODAY_PCT_GOOD = 8
export const ACTIVE_TODAY_PCT_OK = 5

export function toneForActiveTodayPercent(pct: number | null | undefined): MetricTone {
  if (pct == null || !Number.isFinite(pct)) return 'neutral'
  if (pct >= ACTIVE_TODAY_PCT_GOOD) return 'good'
  if (pct < ACTIVE_TODAY_PCT_OK) return 'bad'
  return 'neutral'
}

/**
 * Cumulative registered learners (excl. analytics-excluded seeds).
 * Month-1 base for an early LL app that must later support ~300 paid/mo:
 * at ~3–5% signup→paid you eventually need thousands of signups/month,
 * so a thin first-month base (<80) is behind; ≥200 is a solid launch month.
 */
export const REGISTERED_TOTAL_GOOD = 200
export const REGISTERED_TOTAL_OK = 80

export function toneForRegisteredTotal(total: number | null | undefined): MetricTone {
  if (total == null || !Number.isFinite(total)) return 'neutral'
  if (total >= REGISTERED_TOTAL_GOOD) return 'good'
  if (total < REGISTERED_TOTAL_OK) return 'bad'
  return 'neutral'
}

/** @deprecated use toneForWeeklyRegisteredDelta */
export function toneForWeeklyDelta(
  n: number | null | undefined,
  opts?: { treatZeroAsBad?: boolean },
): MetricTone {
  if (n == null || !Number.isFinite(n)) return 'neutral'
  if (n > 0) return 'good'
  if (n < 0) return 'bad'
  return opts?.treatZeroAsBad ? 'bad' : 'neutral'
}

export function toneColorName(tone: MetricTone): string {
  if (tone === 'good') return 'Green'
  if (tone === 'bad') return 'Red'
  return 'White'
}

export type MetricColorExplanation = {
  title: string
  message: string
}

function toneSentence(tone: MetricTone): string {
  return `Showing ${toneColorName(tone).toLowerCase()} (${tone}).`
}

/**
 * Long-press copy for Admin Home analytics metric cards.
 * Benchmarks: early LL, month 1, path to ~300 paid/mo by month 6.
 */
export function explainRegisteredMetric(args: {
  total: number | null
  thisWeek: number | null
}): MetricColorExplanation {
  const totalTone = toneForRegisteredTotal(args.total)
  const weekTone = toneForWeeklyRegisteredDelta(args.thisWeek)
  const total = args.total
  const week = args.thisWeek

  let totalWhy: string
  if (total == null) totalWhy = 'Total is unavailable.'
  else if (totalTone === 'good') {
    totalWhy = `${total} registered is ≥${REGISTERED_TOTAL_GOOD} — solid month-1 base toward volume for ~300 paid/mo by month 6.`
  } else if (totalTone === 'bad') {
    totalWhy = `${total} registered is <${REGISTERED_TOTAL_OK} — too thin to scale toward ~300 paid/mo without a step-change in signups.`
  } else {
    totalWhy = `${total} registered is between ${REGISTERED_TOTAL_OK}–${REGISTERED_TOTAL_GOOD - 1} — building, not yet a strong launch base.`
  }

  let weekWhy: string
  if (week == null) weekWhy = 'Weekly signups unavailable.'
  else if (weekTone === 'good') {
    weekWhy = `+${week} this week ≥${REGISTERED_WEEKLY_GOOD} — on pace to build an 80–200 registered base in the first 1–2 months.`
  } else if (weekTone === 'bad') {
    weekWhy = `Weekly change is negative.`
  } else if (week >= REGISTERED_WEEKLY_OK) {
    weekWhy = `+${week} this week is growth, but under ${REGISTERED_WEEKLY_GOOD}/week — too slow to reach a solid month-1 base toward ~300 paid/mo by month 6 (white).`
  } else {
    weekWhy = `+0 this week — flat signup growth (white).`
  }

  return {
    title: 'Registered color',
    message: [
      `Total number: ${toneSentence(totalTone)}`,
      totalWhy,
      '',
      `“+N this week”: ${toneSentence(weekTone)}`,
      weekWhy,
      '',
      `Benchmarks (month 1): total ≥${REGISTERED_TOTAL_GOOD} green · ${REGISTERED_TOTAL_OK}–${REGISTERED_TOTAL_GOOD - 1} white · <${REGISTERED_TOTAL_OK} red. Weekly: ≥${REGISTERED_WEEKLY_GOOD} green · ${REGISTERED_WEEKLY_OK}–${REGISTERED_WEEKLY_GOOD - 1} white · 0 white.`,
    ].join('\n'),
  }
}

export function explainActivationMetric(args: {
  percent: number | null
  activatedThisWeek: number | null
  signupsThisWeek: number | null
  activated: number | null
  cohortSize: number | null
}): MetricColorExplanation {
  const pctTone = toneForActivationPercent(args.percent)
  const weekTone = toneForWeeklyActivationDelta(args.activatedThisWeek, args.signupsThisWeek)
  const pct = args.percent
  const aWeek = args.activatedThisWeek ?? 0
  const sWeek = args.signupsThisWeek ?? 0

  let pctWhy: string
  if (pct == null) pctWhy = 'Activation rate unavailable.'
  else if (pctTone === 'good') {
    pctWhy = `${pct.toFixed(0)}% ≥${ACTIVATION_PCT_GOOD}% — beating the 40–60% first-value band used for consumer LL onboarding.`
  } else if (pctTone === 'bad') {
    pctWhy = `${pct.toFixed(0)}% <${ACTIVATION_PCT_OK}% — below the ~40% first-lesson floor typical of consumer LL onboarding.`
  } else {
    pctWhy = `${pct.toFixed(0)}% is in the ${ACTIVATION_PCT_OK}–${ACTIVATION_PCT_GOOD - 1}% competitor band (first-value 40–60%).`
  }
  if (args.activated != null && args.cohortSize != null) {
    pctWhy += ` (${args.activated}/${args.cohortSize} of last ≤50 signups).`
  }

  let weekWhy: string
  if (sWeek > 0 && aWeek === 0) {
    weekWhy = `${sWeek} signup(s) this week but 0 activations — miss (red).`
  } else if (sWeek > 0) {
    const ratio = aWeek / sWeek
    const pctOfSignups = Math.round(ratio * 100)
    if (weekTone === 'good') {
      weekWhy = `+${aWeek} activations vs ${sWeek} signups (${pctOfSignups}%) — ≥${Math.round(ACTIVATION_WEEKLY_VS_SIGNUPS_GOOD * 100)}% of this week’s signups activated (green).`
    } else {
      weekWhy = `+${aWeek} activations vs ${sWeek} signups (${pctOfSignups}%) — under ${Math.round(ACTIVATION_WEEKLY_VS_SIGNUPS_GOOD * 100)}% of weekly signups (white).`
    }
  } else if (aWeek > 0) {
    weekWhy = `+${aWeek} activations with no new signups — older cohort catching up (green).`
  } else {
    weekWhy = `No activations and no signups this week (white).`
  }

  return {
    title: 'Activation color',
    message: [
      `Rate: ${toneSentence(pctTone)}`,
      pctWhy,
      '',
      `“+N this week”: ${toneSentence(weekTone)}`,
      weekWhy,
      '',
      `Rate is activation_complete among the last ≤50 registered IDs (not a newest-events scan). Benchmarks: ≥${ACTIVATION_PCT_GOOD}% green · ${ACTIVATION_PCT_OK}–${ACTIVATION_PCT_GOOD - 1}% white · <${ACTIVATION_PCT_OK}% red. Weekly: ≥${Math.round(ACTIVATION_WEEKLY_VS_SIGNUPS_GOOD * 100)}% of new signups activate → green; 0 activations with signups → red.`,
    ].join('\n'),
  }
}

export function explainPremiumMetric(args: {
  percent: number | null
  paidThisWeek: number | null
  signupsThisWeek: number | null
  paid: number | null
  cohortSize: number | null
}): MetricColorExplanation {
  const pctTone = toneForPremiumPercent(args.percent)
  const weekTone = toneForWeeklyPremiumDelta(args.paidThisWeek, args.signupsThisWeek)
  const pct = args.percent
  const pWeek = args.paidThisWeek ?? 0
  const sWeek = args.signupsThisWeek ?? 0

  let pctWhy: string
  if (pct == null) pctWhy = 'Premium rate unavailable.'
  else if (pctTone === 'good') {
    pctWhy = `${pct.toFixed(0)}% ≥${PREMIUM_PCT_GOOD}% — beating Duolingo paid/MAU (~9%).`
  } else if (pctTone === 'bad') {
    pctWhy = `${pct.toFixed(0)}% <${PREMIUM_PCT_OK}% — below Duolingo’s ~9% paid/MAU band (we use last-50 non-ET store subs).`
  } else {
    pctWhy = `${pct.toFixed(0)}% is in the ${PREMIUM_PCT_OK}–${PREMIUM_PCT_GOOD - 1}% band around Duolingo paid/MAU (~9%).`
  }
  if (args.paid != null && args.cohortSize != null) {
    pctWhy += ` (${args.paid}/${args.cohortSize} clean App Store subs in last ≤50 non-ET signups; ET is excluded because they do not see the store paywall. Family/free/incomplete store flags excluded).`
  }

  let weekWhy: string
  if (pWeek >= PREMIUM_WEEKLY_GOOD) {
    weekWhy = `+${pWeek} paid this week — on month-1 pace toward ~300 paid/mo by month 6 (≥${PREMIUM_WEEKLY_GOOD}/week).`
  } else if (pWeek >= PREMIUM_WEEKLY_OK) {
    weekWhy = `+${pWeek} paid this week — building (${PREMIUM_WEEKLY_OK}–${PREMIUM_WEEKLY_GOOD - 1}/week is white).`
  } else if (sWeek > 0 && pWeek === 0) {
    weekWhy = `${sWeek} signup(s) this week but 0 new clean paid subs — miss (red).`
  } else {
    weekWhy = `+0 paid this week and no signup pressure to convert (white).`
  }

  return {
    title: 'Premium color',
    message: [
      `Rate: ${toneSentence(pctTone)}`,
      pctWhy,
      '',
      `“+N this week”: ${toneSentence(weekTone)}`,
      weekWhy,
      '',
      `Benchmarks: rate ≥${PREMIUM_PCT_GOOD}% green · ${PREMIUM_PCT_OK}–${PREMIUM_PCT_GOOD - 1}% white · <${PREMIUM_PCT_OK}% red. Weekly paid: ≥${PREMIUM_WEEKLY_GOOD} green · ${PREMIUM_WEEKLY_OK}–${PREMIUM_WEEKLY_GOOD - 1} white · 0 with signups red. Only current store Premium with a product id counts.`,
    ].join('\n'),
  }
}

export function explainNotificationsMetric(args: {
  percent: number | null
  on: number | null
  cohortSize: number | null
}): MetricColorExplanation {
  const pctTone = toneForNotificationsPercent(args.percent)
  const pct = args.percent

  let pctWhy: string
  if (pct == null) pctWhy = 'Notifications rate unavailable.'
  else if (pctTone === 'good') {
    pctWhy = `${pct.toFixed(0)}% ≥${NOTIFICATIONS_PCT_GOOD}% — solid push opt-in for a consumer mobile app.`
  } else if (pctTone === 'bad') {
    pctWhy = `${pct.toFixed(0)}% <${NOTIFICATIONS_PCT_OK}% — weak OS notification opt-in; reminders and remote push will under-reach.`
  } else {
    pctWhy = `${pct.toFixed(0)}% is in the ${NOTIFICATIONS_PCT_OK}–${NOTIFICATIONS_PCT_GOOD - 1}% mobile push opt-in band.`
  }
  if (args.on != null && args.cohortSize != null) {
    pctWhy += ` (${args.on}/${args.cohortSize} of last ≤50 signups have an Expo push token).`
  }

  return {
    title: 'Notifications color',
    message: [
      `Rate: ${toneSentence(pctTone)}`,
      pctWhy,
      '',
      `Counted as “on” when the user has a row in push_tokens (OS permission granted and Expo push registered — same pool as broadcast). Local-only reminders without a token are not counted. Benchmarks: ≥${NOTIFICATIONS_PCT_GOOD}% green · ${NOTIFICATIONS_PCT_OK}–${NOTIFICATIONS_PCT_GOOD - 1}% white · <${NOTIFICATIONS_PCT_OK}% red.`,
    ].join('\n'),
  }
}
