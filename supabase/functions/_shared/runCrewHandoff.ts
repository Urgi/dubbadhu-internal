import { jsonResponse } from './cors.ts'
import { CREW_HANDLES } from './obsidianCrew.ts'
import {
  parseObsidianJob,
  serializeObsidianJob,
  workingNote,
  type ObsidianJobPayload,
} from './obsidianJob.ts'
import {
  ACE_WEBHOOK_URL,
  HISTORY_LIMIT,
  historyAsContext,
  oneSentenceGoal,
  type AceRoute,
  type ObsidianMessageRow,
  type Urgency,
} from './obsidian.ts'

type Db = ReturnType<typeof import('./admin.ts').serviceClient>

export async function runCrewHandoff(opts: {
  db: Db
  threadId: string
  route: AceRoute
  content: string
  webhookKey: string
  urgency?: Urgency
  goal?: string
  context?: string
  doneWhen?: string
  deliverable?: string
  existingMessageId?: string
  sourceMessageIds?: string[]
}): Promise<Response | { pending: ObsidianMessageRow }> {
  const { db, threadId, route, content, webhookKey } = opts
  const urgency: Urgency = opts.urgency ?? 'normal'

  const historyRes = await db
    .from('obsidian_messages')
    .select('id, thread_id, role, content, status, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const history = ([...(historyRes.data ?? [])] as ObsidianMessageRow[]).reverse()
  const goal = opts.goal?.trim() || oneSentenceGoal(content)
  const context = opts.context?.trim() || historyAsContext(history)
  const doneWhen =
    opts.doneWhen?.trim() ||
    `Reply in this Obsidian thread by POSTing JSON to /functions/v1/obsidian-reply with thread_id ${threadId}.`

  const existing = opts.existingMessageId
    ? parseObsidianJob(
        history.find((row) => row.id === opts.existingMessageId)?.content ?? '',
      )
    : null

  const job: ObsidianJobPayload = {
    v: 1,
    kind: 'job',
    assignedAgentId: route,
    objective: goal,
    deliverable:
      opts.deliverable?.trim() ||
      existing?.deliverable ||
      'Return the completed work in this Obsidian thread.',
    contextSummary: context.slice(0, 800),
    priority: urgency,
    dueAt: existing?.dueAt ?? null,
    sourceMessageIds: opts.sourceMessageIds ?? existing?.sourceMessageIds ?? [],
    jobStatus: 'in_progress',
    progressNote: workingNote(route),
  }

  const pendingContent = serializeObsidianJob(job)
  let pendingRow: ObsidianMessageRow | null = null

  if (opts.existingMessageId) {
    const updated = await db
      .from('obsidian_messages')
      .update({
        role: route,
        content: pendingContent,
        status: 'pending',
      })
      .eq('id', opts.existingMessageId)
      .eq('thread_id', threadId)
      .select('id, thread_id, role, content, status, created_at')
      .single()
    if (updated.error || !updated.data) {
      return jsonResponse(
        { ok: false, error: updated.error?.message || 'Failed to update job card.' },
        500,
      )
    }
    pendingRow = updated.data as ObsidianMessageRow
  } else {
    const pendingInsert = await db
      .from('obsidian_messages')
      .insert({
        thread_id: threadId,
        role: route,
        content: pendingContent,
        status: 'pending',
      })
      .select('id, thread_id, role, content, status, created_at')
      .single()
    if (pendingInsert.error || !pendingInsert.data) {
      return jsonResponse(
        { ok: false, error: pendingInsert.error?.message || 'Failed to insert working status.' },
        500,
      )
    }
    pendingRow = pendingInsert.data as ObsidianMessageRow
  }

  const payload = {
    goal,
    route,
    context,
    done_when: doneWhen,
    urgency,
    thread_id: threadId,
    source: 'obsidian',
    reply_channel: 'supabase',
    message_id: pendingRow.id,
    agent_name: CREW_HANDLES[route].name,
  }

  try {
    const aceRes = await fetch(ACE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webhookKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!aceRes.ok) {
      const text = await aceRes.text().catch(() => '')
      const failed = serializeObsidianJob({
        ...job,
        jobStatus: 'failed',
        progressNote: `Handoff failed (HTTP ${aceRes.status}). ${text.slice(0, 280)}`.trim(),
      })
      await db
        .from('obsidian_messages')
        .update({ status: 'failed', content: failed })
        .eq('id', pendingRow.id)
      return jsonResponse(
        {
          ok: false,
          error: `Ace webhook HTTP ${aceRes.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        },
        502,
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ace webhook request failed.'
    await db
      .from('obsidian_messages')
      .update({
        status: 'failed',
        content: serializeObsidianJob({ ...job, jobStatus: 'failed', progressNote: `Handoff error: ${message}` }),
      })
      .eq('id', pendingRow.id)
    return jsonResponse({ ok: false, error: message }, 502)
  }

  return { pending: pendingRow }
}
