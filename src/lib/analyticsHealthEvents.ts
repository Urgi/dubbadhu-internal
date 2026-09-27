/** Learner-app reliability signals we treat as crashes / hiccups in admin analytics. */
export const RELIABILITY_EVENT_NAMES = new Set([
  'component_error',
  'critical_issue_alert',
  'lesson_remote_load_failed',
  'practice_feedback_error',
  'signin_failed',
  'profile_fetch_error',
  'subscription_fetch_error',
  'notification_settings_error',
  'community_prefs_fetch_error',
  'community_prefs_save_error',
  'unknown_screen_type',
  'service_init_error',
])

export type ReliabilityEventRow = {
  id: string
  user_id: string | null
  event_name: string
  properties: Record<string, unknown> | null
  created_at: string
}

export type Reliability24hSummary = {
  total: number
  uniqueUsers: number
  /** Issue rows with no users id (signup / sign-in before an account). */
  anonymous: number
  byEventName: { event_name: string; count: number }[]
  recent: {
    event_name: string
    created_at: string
    user_id: string | null
    detail: string
  }[]
}

export function isReliabilityAnalyticsEvent(eventName: string): boolean {
  const n = (eventName || '').trim().toLowerCase()
  if (!n) return false
  if (RELIABILITY_EVENT_NAMES.has(n)) return true
  return n.endsWith('_error') || n.endsWith('_failed')
}

function numProp(props: Record<string, unknown>, key: string): number | null {
  const v = props[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Series / lesson number / title, plus which screen they were on. */
function lessonActivityDetail(
  properties: Record<string, unknown>,
  lessonLabels?: Record<string, string>,
): string {
  const id = typeof properties.lesson_id === 'string' ? properties.lesson_id.trim() : ''
  const storedTitle =
    typeof properties.lesson_title === 'string' ? properties.lesson_title.trim() : ''
  const name =
    (id && lessonLabels?.[id]) ||
    (storedTitle && storedTitle !== id ? storedTitle : '') ||
    id

  const screenIndex = numProp(properties, 'screen_index') ?? numProp(properties, 'exit_screen_index')
  const total = numProp(properties, 'total_screens')
  const screenType =
    typeof properties.screen_type === 'string' ? properties.screen_type.trim() : ''

  const where: string[] = []
  if (screenIndex != null && total != null && total > 0) {
    where.push(`screen ${screenIndex + 1} of ${total}`)
  } else if (screenIndex != null) {
    where.push(`screen ${screenIndex + 1}`)
  }
  if (screenType) where.push(screenType)

  return [name, ...where].filter(Boolean).join(' · ')
}

function pickDetail(
  eventName: string,
  properties: Record<string, unknown> | null,
  lessonLabels?: Record<string, string>,
): string {
  const p = properties ?? {}
  const msg =
    (typeof p.error_message === 'string' && p.error_message.trim()) ||
    (typeof p.reason === 'string' && p.reason.trim()) ||
    (typeof p.lesson_id === 'string' && p.lesson_id.trim()
      ? lessonActivityDetail(p, lessonLabels)
      : '') ||
    (typeof p.context === 'string' && p.context.trim()) ||
    ''
  if (msg) return msg.slice(0, 160)
  const keys = Object.keys(p).slice(0, 3)
  if (keys.length === 0) return '—'
  return keys.map((k) => `${k}: ${String(p[k]).slice(0, 40)}`).join(' · ')
}

/** Compact property line for admin event lists. */
export function formatAnalyticsEventDetail(
  eventName: string,
  properties: Record<string, unknown> | null,
  lessonLabels?: Record<string, string>,
): string {
  return pickDetail(eventName, properties, lessonLabels)
}

/** Aggregate reliability rows for the last-24h admin card. */
export function summarizeReliabilityEvents24h(rows: ReliabilityEventRow[]): Reliability24hSummary {
  const reliability = rows.filter((r) => isReliabilityAnalyticsEvent(r.event_name))
  const counts = new Map<string, number>()
  const users = new Set<string>()
  let anonymous = 0
  for (const row of reliability) {
    counts.set(row.event_name, (counts.get(row.event_name) ?? 0) + 1)
    if (row.user_id) users.add(row.user_id)
    else anonymous += 1
  }
  const byEventName = Array.from(counts.entries())
    .map(([event_name, count]) => ({ event_name, count }))
    .sort((a, b) => b.count - a.count)

  const recent = reliability.slice(0, 8).map((row) => ({
    event_name: row.event_name,
    created_at: row.created_at,
    user_id: row.user_id,
    detail: pickDetail(row.event_name, row.properties),
  }))

  return {
    total: reliability.length,
    uniqueUsers: users.size,
    anonymous,
    byEventName,
    recent,
  }
}

/** Plain-text block for Gemini prompts. */
export function formatReliability24hSummaryForPrompt(summary: Reliability24hSummary): string {
  if (summary.total === 0) {
    return 'Last 24 hours: no component_error or other reliability events in the loaded window.'
  }
  const lines = [
    `Last 24 hours reliability snapshot: ${summary.total} event(s), ${summary.uniqueUsers} unique user(s), ${summary.anonymous} with no account.`,
    'Counts by event_name:',
    ...summary.byEventName.map((r) => `- ${r.event_name}: ${r.count}`),
  ]
  if (summary.recent.length > 0) {
    lines.push('Most recent samples:')
    for (const r of summary.recent) {
      const uid = r.user_id ? r.user_id.slice(0, 8) : 'anon'
      lines.push(`- ${r.created_at} ${r.event_name} (${uid}) ${r.detail}`)
    }
  }
  return lines.join('\n')
}
