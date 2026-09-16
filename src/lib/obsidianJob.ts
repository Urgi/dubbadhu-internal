import { isCrewRouteName } from './obsidianCrew'
import type { ObsidianCrewRoute, ObsidianMessage, ObsidianMessageStatus } from './obsidian'

export const OBS_JOB_PREFIX = 'OBS_JOB:'

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent'
export type JobCardStatus =
  | 'draft'
  | 'assigning'
  | 'assigned'
  | 'in_progress'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ObsidianJobPayload = {
  v: 1
  kind: 'job'
  assignedAgentId: ObsidianCrewRoute
  objective: string
  deliverable: string
  contextSummary: string
  priority: JobPriority
  dueAt?: string | null
  sourceMessageIds?: string[]
  jobStatus: JobCardStatus
  progressNote?: string
  summary?: string
  result?: string
}

export function serializeObsidianJob(job: ObsidianJobPayload): string {
  return `${OBS_JOB_PREFIX}${JSON.stringify(job)}`
}

export function parseObsidianJob(content: string): ObsidianJobPayload | null {
  const trimmed = content.trim()
  const raw = trimmed.startsWith(OBS_JOB_PREFIX)
    ? trimmed.slice(OBS_JOB_PREFIX.length)
    : trimmed.startsWith('{') && trimmed.includes('"kind":"job"')
      ? trimmed
      : null
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ObsidianJobPayload>
    if (parsed.kind !== 'job' || !isCrewRouteName(String(parsed.assignedAgentId ?? ''))) return null
    const priority = parsed.priority
    return {
      v: 1,
      kind: 'job',
      assignedAgentId: parsed.assignedAgentId as ObsidianCrewRoute,
      objective: String(parsed.objective ?? '').trim() || 'Handle this request.',
      deliverable: String(parsed.deliverable ?? '').trim() || 'Return the completed work in this thread.',
      contextSummary: String(parsed.contextSummary ?? '').trim() || 'Current Obsidian thread.',
      priority: priority === 'low' || priority === 'high' || priority === 'urgent' ? priority : 'normal',
      dueAt: parsed.dueAt ?? null,
      sourceMessageIds: Array.isArray(parsed.sourceMessageIds) ? parsed.sourceMessageIds.map(String) : [],
      jobStatus: isJobCardStatus(parsed.jobStatus) ? parsed.jobStatus : 'draft',
      progressNote: parsed.progressNote,
      summary: parsed.summary,
      result: parsed.result,
    }
  } catch {
    return null
  }
}

function isJobCardStatus(value: unknown): value is JobCardStatus {
  return (
    value === 'draft' ||
    value === 'assigning' ||
    value === 'assigned' ||
    value === 'in_progress' ||
    value === 'needs_input' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

export function jobStatusFromMessage(
  status: ObsidianMessageStatus | null,
  payload: ObsidianJobPayload | null,
): JobCardStatus {
  if (status === 'pending') {
    if (payload?.jobStatus === 'assigned') return 'assigned'
    return 'in_progress'
  }
  if (status === 'blocked') return 'needs_input'
  if (status === 'failed') return payload?.jobStatus === 'cancelled' ? 'cancelled' : 'failed'
  if (status === 'done') return 'completed'
  return payload?.jobStatus ?? 'draft'
}

export function looksLikeDataQuestion(text: string): boolean {
  return /\b(users?|retention|funnel|analytics|waitlist|events?|premium|cohort|sql|count)\b/i.test(text)
}

export function firstParagraph(text: string, max = 220): string {
  const line = text.trim().split(/\n+/)[0]?.replace(/\s+/g, ' ') ?? ''
  if (!line) return ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function dateKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const today = new Date()
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startToday - startThat) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function formatClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function isStructuredJobMessage(row: ObsidianMessage): boolean {
  return Boolean(parseObsidianJob(row.content)) || (row.role !== 'user' && row.role !== 'chatgpt' && Boolean(row.status))
}
