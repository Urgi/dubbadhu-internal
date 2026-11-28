import type { SupabaseClient } from '@supabase/supabase-js'
import { eventArm } from './experimentResults'

/**
 * Admin learner lookup: find a learner by name, email or phone, then one timeline from
 * analytics_events (signup, lessons, paywall, purchases, revenuecat_event, critical_issue_alert)
 * and learner_email_log (emails sent). Reads with the admin client (service role).
 */

export type LearnerMatch = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  isPremium: boolean | null
  premium_source: string | null
  premium_product_id: string | null
  premium_expires_at: string | null
  premium_will_renew: boolean | null
  exclude_from_analytics: boolean | null
}

export type TimelineCategory = 'signup' | 'lessons' | 'money' | 'problems' | 'email'

export type TimelineItem = {
  id: string
  at: string
  category: TimelineCategory
  title: string
  detail: string
}

const USER_COLUMNS =
  'id, first_name, last_name, email, phone, created_at, isPremium, premium_source, premium_product_id, premium_expires_at, premium_will_renew, exclude_from_analytics'

/** Events shown on the timeline. Everything else (screen views, dwell…) is noise here. */
export const TIMELINE_EVENT_NAMES = [
  'signup_started',
  'signup_completed',
  'lesson_completed',
  'series_intro_lesson_started',
  'paywall_viewed',
  'purchase_started',
  'purchase_cancelled',
  'purchase_failed',
  'premium_purchased',
  'trial_started',
  'trial_converted',
  'trial_cancelled',
  'trial_expired',
  'revenuecat_event',
  'critical_issue_alert',
  'lesson_remote_load_failed',
  'experiment_exposed',
] as const

export function learnerDisplayName(u: Pick<LearnerMatch, 'first_name' | 'last_name' | 'email' | 'phone' | 'id'>): string {
  const name = [u.first_name, u.last_name].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')
  return name || u.email || u.phone || u.id.slice(0, 8)
}

/** PostgREST `or()` breaks on commas and parentheses; drop them from free text. */
function cleanSearchText(q: string): string {
  return q.replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchLearners(
  client: SupabaseClient,
  rawQuery: string,
): Promise<{ data: LearnerMatch[]; error: string | null }> {
  const q = cleanSearchText(rawQuery)
  if (q.length < 2) return { data: [], error: null }
  const digits = q.replace(/\D/g, '')
  let query = client.from('users').select(USER_COLUMNS).order('created_at', { ascending: false }).limit(20)
  if (digits.length >= 4 && digits.length >= q.replace(/[\s+-]/g, '').length - 1) {
    query = query.ilike('phone', `%${digits}%`)
  } else {
    const parts = q.split(' ').filter(Boolean)
    if (parts.length >= 2) {
      // "First Last"
      query = query.ilike('first_name', `%${parts[0]}%`).ilike('last_name', `%${parts.slice(1).join(' ')}%`)
    } else {
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`)
    }
  }
  const { data, error } = await query
  if (error) return { data: [], error: error.message }
  return { data: (data ?? []) as LearnerMatch[], error: null }
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** Map one analytics_events row to a timeline line. Exported for testing. */
export function eventToTimelineItem(row: {
  id?: string | number | null
  event_name: string
  properties: Record<string, unknown> | null
  created_at: string
}): TimelineItem {
  const p = row.properties ?? {}
  const id = `e-${row.id ?? `${row.event_name}-${row.created_at}`}`
  const at = row.created_at
  const name = row.event_name
  const version = str(p.app_version) ? ` · v${str(p.app_version)}` : ''
  switch (name) {
    case 'signup_started':
      return { id, at, category: 'signup', title: 'Started signup', detail: `${str(p.platform)}${version}` }
    case 'signup_completed':
      return { id, at, category: 'signup', title: 'Finished signup', detail: `${str(p.platform)}${version}` }
    case 'lesson_completed':
      return {
        id,
        at,
        category: 'lessons',
        title: `Finished ${str(p.lesson_title) || str(p.lesson_id) || 'a lesson'}`,
        detail: [str(p.series), str(p.lessons_total_completed) && `${str(p.lessons_total_completed)} total`]
          .filter(Boolean)
          .join(' · '),
      }
    case 'series_intro_lesson_started':
      return { id, at, category: 'lessons', title: 'Started a series intro', detail: str(p.series) }
    case 'paywall_viewed':
      return { id, at, category: 'money', title: 'Saw the paywall', detail: str(p.source) || str(p.trigger) }
    case 'purchase_started':
      return { id, at, category: 'money', title: 'Tapped buy', detail: str(p.product_id) || str(p.package) }
    case 'purchase_cancelled':
      return { id, at, category: 'money', title: 'Cancelled the purchase sheet', detail: str(p.product_id) }
    case 'purchase_failed':
      return { id, at, category: 'problems', title: 'Purchase failed', detail: str(p.error) || str(p.message) }
    case 'premium_purchased':
      return { id, at, category: 'money', title: 'Bought Premium', detail: str(p.product_id) || str(p.productId) }
    case 'trial_started':
    case 'trial_converted':
    case 'trial_cancelled':
    case 'trial_expired': {
      const word = name.replace('trial_', '')
      return {
        id,
        at,
        category: 'money',
        title: `Trial ${word}`,
        detail: [str(p.product_id), str(p.source) === 'revenuecat_webhook' ? 'RevenueCat' : 'app'].filter(Boolean).join(' · '),
      }
    }
    case 'revenuecat_event': {
      const type = str(p.rc_type).toUpperCase()
      const problem = type === 'BILLING_ISSUE' || type === 'EXPIRATION' || type === 'CANCELLATION'
      const label: Record<string, string> = {
        INITIAL_PURCHASE: 'RevenueCat: first purchase',
        RENEWAL: 'RevenueCat: renewed',
        BILLING_ISSUE: 'RevenueCat: billing issue',
        CANCELLATION: 'RevenueCat: turned off renewal',
        UNCANCELLATION: 'RevenueCat: turned renewal back on',
        EXPIRATION: 'RevenueCat: expired',
        PRODUCT_CHANGE: 'RevenueCat: changed plan',
      }
      return {
        id,
        at,
        category: problem ? 'problems' : 'money',
        title: label[type] ?? `RevenueCat: ${type || 'event'}`,
        detail: [
          str(p.product_id),
          str(p.period_type),
          str(p.store),
          str(p.amount) && `${str(p.amount)} ${str(p.currency)}`,
          str(p.cancel_reason) || str(p.expiration_reason),
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    case 'critical_issue_alert':
      return {
        id,
        at,
        category: 'problems',
        title: `Issue report: ${str(p.title) || str(p.category) || 'critical'}`,
        detail: [str(p.description).slice(0, 140), str(p.screen_type), version.replace(' · ', '')].filter(Boolean).join(' · '),
      }
    case 'lesson_remote_load_failed':
      return { id, at, category: 'problems', title: 'Lesson failed to load', detail: str(p.lesson_id) || str(p.error) }
    case 'experiment_exposed':
      return {
        id,
        at,
        category: 'signup',
        title: `In test ${str(p.experiment_key)}`,
        detail: eventArm(p, str(p.experiment_key)),
      }
    default:
      return { id, at, category: 'signup', title: name, detail: '' }
  }
}

export async function fetchLearnerTimeline(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: TimelineItem[]; error: string | null; truncated: boolean }> {
  const LIMIT = 500
  const [eventsRes, emailRes] = await Promise.all([
    client
      .from('analytics_events')
      .select('id, event_name, properties, created_at')
      .eq('user_id', userId)
      .in('event_name', [...TIMELINE_EVENT_NAMES])
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    client
      .from('learner_email_log')
      .select('kind, sent_at, resend_id')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(100),
  ])
  if (eventsRes.error) return { data: [], error: eventsRes.error.message, truncated: false }
  const rows = (eventsRes.data ?? []) as Array<{
    id: string | number
    event_name: string
    properties: Record<string, unknown> | null
    created_at: string
  }>
  // The app logs an exposure on every launch; keep only the first one per experiment.
  const seenExperiment = new Set<string>()
  const firstOnly = [...rows].reverse().filter((r) => {
    if (r.event_name !== 'experiment_exposed') return true
    const key = str(r.properties?.experiment_key)
    if (seenExperiment.has(key)) return false
    seenExperiment.add(key)
    return true
  })
  const items: TimelineItem[] = firstOnly.map(eventToTimelineItem)
  for (const row of (emailRes.data ?? []) as Array<{ kind: string | null; sent_at: string; resend_id: string | null }>) {
    items.push({
      id: `m-${row.resend_id ?? row.sent_at}`,
      at: row.sent_at,
      category: 'email',
      title: `Email sent: ${str(row.kind) || 'email'}`,
      detail: row.resend_id ? `Resend ${row.resend_id.slice(0, 8)}` : '',
    })
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return {
    data: items,
    // The email log is optional; a missing table should not hide the events.
    error: emailRes.error ? `Emails: ${emailRes.error.message}` : null,
    truncated: (eventsRes.data ?? []).length >= LIMIT,
  }
}
