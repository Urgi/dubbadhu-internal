import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireEnv, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import {
  isCrewRoute,
  isMessageStatus,
  isUuid,
  secretEquals,
} from '../_shared/obsidian.ts'
import { parseObsidianJob, serializeObsidianJob } from '../_shared/obsidianJob.ts'

type ReplyBody = {
  thread_id?: string
  role?: string
  content?: string
  status?: string
  handoff_id?: string
}

function replySecretFromRequest(req: Request): string {
  const headerKey = req.headers.get('x-obsidian-reply-key')?.trim() ?? ''
  if (headerKey) return headerKey
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405)
  }

  const expected = requireEnv('ACE_OBSIDIAN_REPLY_KEY')
  if (expected instanceof Response) return expected

  const received = replySecretFromRequest(req)
  if (!received) {
    return jsonResponse(
      {
        ok: false,
        error:
          'Missing ACE_OBSIDIAN_REPLY_KEY. Send Authorization: Bearer <ACE_OBSIDIAN_REPLY_KEY> (or x-obsidian-reply-key).',
      },
      401,
    )
  }
  if (!secretEquals(expected, received)) {
    return jsonResponse({ ok: false, error: 'Invalid ACE_OBSIDIAN_REPLY_KEY.' }, 401)
  }

  let body: ReplyBody
  try {
    body = (await req.json()) as ReplyBody
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be JSON.' }, 400)
  }

  const threadId = String(body.thread_id ?? '').trim()
  const role = String(body.role ?? '').trim()
  const content = String(body.content ?? '').trim()
  const status = String(body.status ?? 'done').trim()
  const handoffId = String(body.handoff_id ?? '').trim()

  if (!isUuid(threadId)) {
    return jsonResponse({ ok: false, error: 'thread_id must be a UUID.' }, 400)
  }
  if (!isCrewRoute(role)) {
    return jsonResponse({ ok: false, error: 'role must be ace | moti | jack | queen | nigus.' }, 400)
  }
  if (!content) {
    return jsonResponse({ ok: false, error: 'content is required.' }, 400)
  }
  if (!isMessageStatus(status) || status === 'pending') {
    return jsonResponse({ ok: false, error: 'status must be done | blocked | failed.' }, 400)
  }

  const db = serviceClient()
  const threadRes = await db.from('obsidian_threads').select('id').eq('id', threadId).maybeSingle()
  if (threadRes.error) {
    return jsonResponse({ ok: false, error: threadRes.error.message }, 500)
  }
  if (!threadRes.data) {
    return jsonResponse({ ok: false, error: 'Thread not found.' }, 404)
  }

  const pendingRes = await db
    .from('obsidian_messages')
    .select('id, thread_id, role, content, status, created_at')
    .eq('thread_id', threadId)
    .eq('status', 'pending')
    .eq('role', role)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const previous = pendingRes.data
    ? parseObsidianJob(String((pendingRes.data as { content?: string }).content ?? ''))
    : null
  const summary = content.trim().split(/\n+/)[0]?.replace(/\s+/g, ' ').slice(0, 220) ?? content.slice(0, 220)
  const storedContent = previous
    ? serializeObsidianJob({
        ...previous,
        assignedAgentId: isCrewRoute(role) ? role : previous.assignedAgentId,
        jobStatus: status === 'blocked' ? 'needs_input' : status === 'failed' ? 'failed' : 'completed',
        summary,
        result: content,
        progressNote: undefined,
      })
    : content

  if (pendingRes.data?.id) {
    const updated = await db
      .from('obsidian_messages')
      .update({ content: storedContent, status, role })
      .eq('id', pendingRes.data.id)
      .select('id, thread_id, role, content, status, created_at')
      .single()
    if (updated.error || !updated.data) {
      return jsonResponse({ ok: false, error: updated.error?.message || 'Failed to update job result.' }, 500)
    }
    await db
      .from('obsidian_messages')
      .delete()
      .eq('thread_id', threadId)
      .eq('status', 'pending')
      .neq('id', updated.data.id)
    return jsonResponse({
      ok: true,
      message: updated.data,
      handoff_id: handoffId || null,
    })
  }

  const insert = await db
    .from('obsidian_messages')
    .insert({
      thread_id: threadId,
      role,
      content: storedContent,
      status,
    })
    .select('id, thread_id, role, content, status, created_at')
    .single()

  if (insert.error || !insert.data) {
    return jsonResponse({ ok: false, error: insert.error?.message || 'Failed to insert reply.' }, 500)
  }

  await db.from('obsidian_messages').delete().eq('thread_id', threadId).eq('status', 'pending')

  return jsonResponse({
    ok: true,
    message: insert.data,
    handoff_id: handoffId || null,
  })
})
