export const MESSAGE_ROLES = ['user', 'chatgpt', 'ace', 'moti', 'jack', 'queen', 'nigus'] as const
export type ObsidianRole = (typeof MESSAGE_ROLES)[number]

export const CREW_ROUTES = ['ace', 'moti', 'jack', 'queen', 'nigus'] as const
export type AceRoute = (typeof CREW_ROUTES)[number]

export const URGENCIES = ['low', 'normal', 'high'] as const
export type Urgency = (typeof URGENCIES)[number]

export const MESSAGE_STATUSES = ['pending', 'done', 'blocked', 'failed'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export const HISTORY_LIMIT = 20

export const ACE_WEBHOOK_URL =
  'https://api2.cursor.sh/automations/webhook/0835af8b-646e-521e-8718-89afe185f3e0'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function isRole(value: string): value is ObsidianRole {
  return (MESSAGE_ROLES as readonly string[]).includes(value)
}

export function isCrewRoute(value: string): value is AceRoute {
  return (CREW_ROUTES as readonly string[]).includes(value)
}

export function isUrgency(value: string): value is Urgency {
  return (URGENCIES as readonly string[]).includes(value)
}

export function isMessageStatus(value: string): value is MessageStatus {
  return (MESSAGE_STATUSES as readonly string[]).includes(value)
}

export type ObsidianMessageRow = {
  id: string
  thread_id: string
  role: ObsidianRole
  content: string
  status: MessageStatus | null
  created_at: string
}

export function oneSentenceGoal(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const sentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed
  const goal = sentence.slice(0, 240)
  if (!goal) return 'Handle this Obsidian request.'
  return /^(please |handle |draft |write |fix |check |look |review |plan |summarize )/i.test(goal)
    ? goal
    : `Handle this: ${goal}`
}

export function historyAsContext(rows: ObsidianMessageRow[]): string {
  if (!rows.length) return '(empty thread)'
  return rows
    .filter((row) => row.status !== 'pending')
    .map((row) => `${row.role}: ${row.content}`)
    .join('\n')
}

export function titleFromMessage(text: string): string {
  const line = text.trim().split('\n')[0]?.replace(/\s+/g, ' ') ?? ''
  if (!line) return 'New thread'
  return line.length > 72 ? `${line.slice(0, 69)}…` : line
}

export function secretEquals(expected: string, received: string): boolean {
  const a = expected
  const b = received
  const max = Math.max(a.length, b.length)
  let out = a.length === b.length ? 0 : 1
  for (let i = 0; i < max; i++) {
    out |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return out === 0
}
