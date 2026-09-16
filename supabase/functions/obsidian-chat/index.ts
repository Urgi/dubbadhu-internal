import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, requireEnv, isAdminCaller, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import {
  HISTORY_LIMIT,
  isUuid,
  titleFromMessage,
  type ObsidianMessageRow,
} from '../_shared/obsidian.ts'
import {
  heuristicObsidianSendDecision,
  OBSIDIAN_ROUTE_SYSTEM,
  parseObsidianSendDecision,
  type ObsidianSendDecision,
} from '../_shared/obsidianRoute.ts'
import { runCrewHandoff } from '../_shared/runCrewHandoff.ts'
import { execReadonlySql, OBSIDIAN_SQL_MAX_ROUNDS, RUN_SQL_TOOL } from '../_shared/obsidianSql.ts'

const SYSTEM_PROMPT = `You are Obsidian, the Dubbadhu internal thinking desk (Afaan Oromo learning app).
You have a read-only SQL tool (run_sql) against production Postgres. Use it for analytics, funnels, users, events, retention, waitlist, and similar lookups instead of guessing.
If the work needs a teammate to execute (code, deploy, Notion, Drive), say so briefly — the desk will hand it off when asked.

SQL rules:
- One SELECT or WITH … SELECT. Cap with LIMIT. Prefer counts and aggregates.
- Exclude internal/test accounts: users.exclude_from_analytics = false. Quote "isPremium".
- Ethiopia phones start with 251 after stripping non-digits.
- Do not dump huge row lists in the reply; summarize.

Useful tables:
- analytics_events(id uuid, user_id uuid, event_name text, properties jsonb, created_at timestamptz)
  Typical events: signup_completed, activation_complete, app_opened, lesson_started, lesson_completed, lesson_screen_viewed, lesson_exited, sentence_submitted, vocab_quiz_*, subscription_viewed, premium_purchased, component_error, *_error / *_failed
- users(id, phone, first_name, "isPremium", created_at, lessons_completed, exclude_from_analytics, premium_source, premium_product_id)
- waitlist_signups, retention_cohorts (view), lesson_series, lessons`

type ChatBody = {
  thread_id?: string
  content?: string
  message?: string
}

type OpenAiToolCall = {
  id: string
  type?: string
  function?: { name?: string; arguments?: string }
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

async function classifySend(
  openaiKey: string,
  content: string,
): Promise<ObsidianSendDecision> {
  const fallback = heuristicObsidianSendDecision(content)
  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 40,
        messages: [
          { role: 'system', content: OBSIDIAN_ROUTE_SYSTEM },
          { role: 'user', content },
        ],
      }),
    })
    const completion = (await openaiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = completion.choices?.[0]?.message?.content?.trim() ?? ''
    return parseObsidianSendDecision(raw) ?? fallback
  } catch {
    return fallback
  }
}

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

  const decision = await classifySend(openaiKey, content)
  if (decision.action === 'handoff') {
    const webhookKey = requireEnv('ACE_WEBHOOK_KEY')
    if (webhookKey instanceof Response) return webhookKey
    const handed = await runCrewHandoff({
      db,
      threadId,
      route: decision.route,
      content,
      webhookKey,
    })
    if (handed instanceof Response) return handed
    return jsonResponse({
      ok: true,
      user_message: userInsert.data,
      pending: handed.pending,
      routed: decision.route,
    })
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
  let replyText = ''
  try {
    const working: OpenAiMessage[] = [...openaiMessages]
    for (let round = 0; round < OBSIDIAN_SQL_MAX_ROUNDS; round += 1) {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: working,
          tools: [RUN_SQL_TOOL],
          tool_choice: 'auto',
        }),
      })
      const completion = (await openaiRes.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
        }>
        error?: { message?: string }
      }
      if (!openaiRes.ok) {
        const detail = completion.error?.message || `OpenAI HTTP ${openaiRes.status}`
        return jsonResponse({ ok: false, error: detail }, 502)
      }
      const message = completion.choices?.[0]?.message
      const toolCalls = message?.tool_calls?.filter((call) => call?.id && call.function?.name) ?? []
      if (toolCalls.length === 0) {
        replyText = message?.content?.trim() ?? ''
        break
      }
      working.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls,
      })
      for (const call of toolCalls) {
        let parsed: { sql?: string } = {}
        try {
          parsed = JSON.parse(call.function?.arguments || '{}') as { sql?: string }
        } catch {
          parsed = {}
        }
        const result =
          call.function?.name === 'run_sql'
            ? await execReadonlySql(db, parsed.sql)
            : { ok: false as const, error: `Unknown tool ${call.function?.name ?? ''}` }
        working.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
      }
    }
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'OpenAI request failed.' },
      502,
    )
  }

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
