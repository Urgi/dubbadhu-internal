import { jsonResponse } from './cors.ts'
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

  const pendingInsert = await db
    .from('obsidian_messages')
    .insert({
      thread_id: threadId,
      role: route,
      content: `${route === 'ace' ? 'Ace' : route} working…`,
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

  const payload = {
    goal,
    route,
    context,
    done_when: doneWhen,
    urgency,
    thread_id: threadId,
    source: 'obsidian',
    reply_channel: 'supabase',
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
      await db
        .from('obsidian_messages')
        .update({
          status: 'failed',
          content: `Handoff failed (HTTP ${aceRes.status}). ${text.slice(0, 280)}`.trim(),
        })
        .eq('id', pendingInsert.data.id)
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
      .update({ status: 'failed', content: `Handoff error: ${message}` })
      .eq('id', pendingInsert.data.id)
    return jsonResponse({ ok: false, error: message }, 502)
  }

  return { pending: pendingInsert.data as ObsidianMessageRow }
}
