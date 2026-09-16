import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, requireEnv, isAdminCaller, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import { isCrewRoute, isUrgency, isUuid, titleFromMessage, type AceRoute, type Urgency } from '../_shared/obsidian.ts'
import { runCrewHandoff } from '../_shared/runCrewHandoff.ts'

type HandoffBody = {
  thread_id?: string
  content?: string
  message?: string
  goal?: string
  route?: string
  context?: string
  done_when?: string
  urgency?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!isAdminCaller(admin)) return admin

  const webhookKey = requireEnv('ACE_WEBHOOK_KEY')
  if (webhookKey instanceof Response) return webhookKey

  let body: HandoffBody
  try {
    body = (await req.json()) as HandoffBody
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be JSON.' }, 400)
  }

  const threadId = String(body.thread_id ?? '').trim()
  const content = String(body.content ?? body.message ?? '').trim()
  if (!isUuid(threadId)) {
    return jsonResponse({ ok: false, error: 'thread_id must be a UUID.' }, 400)
  }
  if (!content) {
    return jsonResponse({ ok: false, error: 'Message text is required.' }, 400)
  }

  const requestedRoute = String(body.route ?? 'ace').trim() || 'ace'
  if (!isCrewRoute(requestedRoute)) {
    return jsonResponse(
      { ok: false, error: 'route must be ace | moti | jack | queen | nigus.' },
      400,
    )
  }
  const route: AceRoute = requestedRoute

  const requestedUrgency = String(body.urgency ?? 'normal').trim() || 'normal'
  if (!isUrgency(requestedUrgency)) {
    return jsonResponse({ ok: false, error: 'urgency must be low | normal | high.' }, 400)
  }
  const urgency: Urgency = requestedUrgency

  const db = serviceClient()
  const threadRes = await db.from('obsidian_threads').select('id, title').eq('id', threadId).maybeSingle()
  if (threadRes.error) {
    return jsonResponse({ ok: false, error: threadRes.error.message }, 500)
  }
  if (!threadRes.data) {
    return jsonResponse({ ok: false, error: 'Thread not found.' }, 404)
  }

  const userInsert = await db
    .from('obsidian_messages')
    .insert({
      thread_id: threadId,
      role: 'user',
      content,
      status: null,
    })
    .select('id, thread_id, role, content, status, created_at')
    .single()
  if (userInsert.error || !userInsert.data) {
    return jsonResponse({ ok: false, error: userInsert.error?.message || 'Failed to insert user message.' }, 500)
  }

  if (!threadRes.data.title || threadRes.data.title === 'New thread') {
    await db.from('obsidian_threads').update({ title: titleFromMessage(content) }).eq('id', threadId)
  }

  const handed = await runCrewHandoff({
    db,
    threadId,
    route,
    content,
    webhookKey,
    urgency,
    goal: String(body.goal ?? '').trim(),
    context: String(body.context ?? '').trim(),
    doneWhen: String(body.done_when ?? '').trim(),
  })
  if (handed instanceof Response) return handed

  return jsonResponse({
    ok: true,
    user_message: userInsert.data,
    pending: handed.pending,
  })
})
