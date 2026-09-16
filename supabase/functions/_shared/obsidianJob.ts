import { CREW_HANDLES } from './obsidianCrew.ts'
import { isCrewRoute, type AceRoute } from './obsidian.ts'

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
  assignedAgentId: AceRoute
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
    if (parsed.kind !== 'job' || !isCrewRoute(String(parsed.assignedAgentId ?? ''))) return null
    const priority = parsed.priority
    return {
      v: 1,
      kind: 'job',
      assignedAgentId: parsed.assignedAgentId as AceRoute,
      objective: String(parsed.objective ?? '').trim() || 'Handle this request.',
      deliverable: String(parsed.deliverable ?? '').trim() || 'Return the completed work in this thread.',
      contextSummary: String(parsed.contextSummary ?? '').trim() || 'Current Obsidian thread.',
      priority: priority === 'low' || priority === 'high' || priority === 'urgent' ? priority : 'normal',
      dueAt: parsed.dueAt ?? null,
      sourceMessageIds: Array.isArray(parsed.sourceMessageIds) ? parsed.sourceMessageIds.map(String) : [],
      jobStatus: parsed.jobStatus ?? 'draft',
      progressNote: parsed.progressNote,
      summary: parsed.summary,
      result: parsed.result,
    }
  } catch {
    return null
  }
}

export function workingNote(route: AceRoute): string {
  return `${CREW_HANDLES[route].name} is working on the assigned job.`
}

export const JOB_DRAFT_SYSTEM = `Convert the Obsidian thread into a job draft. Reply with JSON only:
{"assignedAgentId":"ace"|"moti"|"jack"|"queen"|"nigus","objective":"clear outcome","deliverable":"what should be returned","contextSummary":"short thread context","priority":"low"|"normal"|"high"|"urgent"}
Keep fields concise. Do not invent facts missing from the thread.`
