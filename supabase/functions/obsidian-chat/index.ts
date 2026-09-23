import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, requireEnv, isAdminCaller, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import {
  HISTORY_LIMIT,
  isCrewRoute,
  isUuid,
  titleFromMessage,
  type AceRoute,
  type ObsidianMessageRow,
} from '../_shared/obsidian.ts'
import {
  heuristicObsidianSendDecision,
  OBSIDIAN_ROUTE_SYSTEM,
  parseObsidianSendDecision,
  resolveObsidianSendDecision,
  type ObsidianSendDecision,
} from '../_shared/obsidianRoute.ts'
import { CREW_HANDLES } from '../_shared/obsidianCrew.ts'
import { JOB_DRAFT_SYSTEM, serializeObsidianJob, type ObsidianJobPayload } from '../_shared/obsidianJob.ts'
import { OBSIDIAN_SYSTEM_PROMPT } from '../_shared/obsidianPrompt.ts'
import { execReadonlySql, OBSIDIAN_SQL_MAX_ROUNDS, RUN_SQL_TOOL } from '../_shared/obsidianSql.ts'

type ChatBody = {
  thread_id?: string
  content?: string
  message?: string
  draft_job?: boolean
  route?: string
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

async function draftJobFromThread(
  openaiKey: string,
  route: AceRoute,
  content: string,
  historyText: string,
): Promise<ObsidianJobPayload> {
  const fallback: ObsidianJobPayload = {
    v: 1,
    kind: 'job',
    assignedAgentId: route,
    objective: content.slice(0, 240) || `Work for ${CREW_HANDLES[route].name}`,
    deliverable: 'Return the completed work in this Obsidian thread.',
    contextSummary: historyText.slice(0, 600) || 'Current Obsidian thread.',
    priority: 'normal',
    dueAt: null,
    sourceMessageIds: [],
    jobStatus: 'draft',
  }
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
        max_tokens: 400,
        messages: [
          { role: 'system', content: JOB_DRAFT_SYSTEM },
          {
            role: 'user',
            content: `Preferred agent: ${route}\nLatest request:\n${content}\n\nThread:\n${historyText}`,
          },
        ],
      }),
    })
    const completion = (await openaiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = completion.choices?.[0]?.message?.content?.trim() ?? ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    const parsed = JSON.parse(match[0]) as {
      assignedAgentId?: string
      objective?: string
      deliverable?: string
      contextSummary?: string
      priority?: string
    }
    const assigned = isCrewRoute(String(parsed.assignedAgentId ?? route))
      ? (parsed.assignedAgentId as AceRoute)
      : route
    const priority = parsed.priority
    return {
      ...fallback,
      assignedAgentId: assigned,
      objective: String(parsed.objective ?? fallback.objective).trim() || fallback.objective,
      deliverable: String(parsed.deliverable ?? fallback.deliverable).trim() || fallback.deliverable,
      contextSummary:
        String(parsed.contextSummary ?? fallback.contextSummary).trim() || fallback.contextSummary,
      priority:
        priority === 'low' || priority === 'high' || priority === 'urgent' ? priority : 'normal',
    }
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

  const requestedRoute = String(body.route ?? '').trim()
  const forceDraft = body.draft_job === true && isCrewRoute(requestedRoute)
  const decision = forceDraft
    ? ({ action: 'handoff', route: requestedRoute } as const)
    : resolveObsidianSendDecision(content, await classifySend(openaiKey, content))
  if (decision.action === 'handoff') {
    const historyForDraft = await db
      .from('obsidian_messages')
      .select('id, thread_id, role, content, status, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    const historyText = ([...(historyForDraft.data ?? [])] as ObsidianMessageRow[])
      .reverse()
      .filter((row) => row.status !== 'pending')
      .map((row) => `${row.role}: ${row.content}`)
      .join('\n')
    const job = await draftJobFromThread(openaiKey, decision.route, content, historyText)
    job.sourceMessageIds = [userInsert.data.id]
    const noteInsert = await db
      .from('obsidian_messages')
      .insert({
        thread_id: threadId,
        role: 'chatgpt',
        content: `Ready to hand this to ${CREW_HANDLES[job.assignedAgentId].name}. Review the job card before it is assigned.`,
        status: 'done',
      })
      .select('id, thread_id, role, content, status, created_at')
      .single()
    const draftInsert = await db
      .from('obsidian_messages')
      .insert({
        thread_id: threadId,
        role: job.assignedAgentId,
        content: serializeObsidianJob(job),
        status: null,
      })
      .select('id, thread_id, role, content, status, created_at')
      .single()
    if (draftInsert.error || !draftInsert.data) {
      return jsonResponse(
        { ok: false, error: draftInsert.error?.message || 'Failed to insert job draft.' },
        500,
      )
    }
    return jsonResponse({
      ok: true,
      user_message: userInsert.data,
      reply: noteInsert.data ?? undefined,
      job_draft: draftInsert.data,
      routed: job.assignedAgentId,
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

  const openaiMessages: OpenAiMessage[] = [{ role: 'system', content: OBSIDIAN_SYSTEM_PROMPT }]
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
