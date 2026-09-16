import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, requireEnv, isAdminCaller, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import {
  HISTORY_LIMIT,
  isUuid,
  titleFromMessage,
  type ObsidianMessageRow,
} from '../_shared/obsidian.ts'

const SYSTEM_PROMPT =
  'You are ChatGPT in Obsidian, the Dubbadhu internal thinking desk. Help with thinking and drafting. You do not have Notion, Drive, or engineering connectors. For stack, ops, or teammate work, tell the admin to use Hand to Ace in this app.'

type ChatBody = {
  thread_id?: string
  content?: string
  message?: string
}

type OpenAiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!isAdminCaller(admin)) return admin

  const openaiKey = requireEnv('OPENAI_API_KEY')
  if (openaiKey instanceof Response) return openaiKey

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
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

  const historyRes = await db
    .from('obsidian_messages')
    .select('id, thread_id, role, content, status, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (historyRes.error) {
    return jsonResponse({ ok: false, error: historyRes.error.message }, 500)
  }

  const chronological = ([...(historyRes.data ?? [])] as ObsidianMessageRow[])
    .filter((row) => row.status !== 'pending')
    .reverse()

  const openaiMessages: OpenAiMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const row of chronological) {
    if (row.role === 'user') {
      openaiMessages.push({ role: 'user', content: row.content })
    } else if (row.role === 'chatgpt') {
      openaiMessages.push({ role: 'assistant', content: row.content })
    } else {
      openaiMessages.push({ role: 'assistant', content: `[${row.role}] ${row.content}` })
    }
  }

  const model = Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-4o-mini'
  let completion: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
      }),
    })
    completion = (await openaiRes.json()) as typeof completion
    if (!openaiRes.ok) {
      const detail = completion.error?.message || `OpenAI HTTP ${openaiRes.status}`
      return jsonResponse({ ok: false, error: detail }, 502)
    }
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'OpenAI request failed.' },
      502,
    )
  }

  const replyText = completion.choices?.[0]?.message?.content?.trim()
  if (!replyText) {
    return jsonResponse({ ok: false, error: 'OpenAI returned an empty reply.' }, 502)
  }

  const assistantInsert = await db
    .from('obsidian_messages')
    .insert({
      thread_id: threadId,
      role: 'chatgpt',
      content: replyText,
      status: 'done',
    })
    .select('id, thread_id, role, content, status, created_at')
    .single()

  if (assistantInsert.error || !assistantInsert.data) {
    return jsonResponse(
      { ok: false, error: assistantInsert.error?.message || 'Failed to insert ChatGPT reply.' },
      500,
    )
  }

  return jsonResponse({
    ok: true,
    user_message: userInsert.data,
    reply: assistantInsert.data,
  })
})
