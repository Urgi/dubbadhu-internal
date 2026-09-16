import supabase from './supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export const OBSIDIAN_ROLES = ['user', 'chatgpt', 'ace', 'moti', 'jack', 'queen', 'nigus'] as const
export type ObsidianRole = (typeof OBSIDIAN_ROLES)[number]

export const OBSIDIAN_CREW_ROUTES = ['ace', 'moti', 'jack', 'queen', 'nigus'] as const
export type ObsidianCrewRoute = (typeof OBSIDIAN_CREW_ROUTES)[number]

export const OBSIDIAN_STATUSES = ['pending', 'done', 'blocked', 'failed'] as const
export type ObsidianMessageStatus = (typeof OBSIDIAN_STATUSES)[number]

export type ObsidianThread = {
  id: string
  title: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ObsidianMessage = {
  id: string
  thread_id: string
  role: ObsidianRole
  content: string
  status: ObsidianMessageStatus | null
  created_at: string
}

export const OBSIDIAN_ROLE_LABEL: Record<ObsidianRole, string> = {
  user: 'user',
  chatgpt: 'chatgpt',
  ace: 'ace',
  moti: 'moti',
  jack: 'jack',
  queen: 'queen',
  nigus: 'nigus',
}

type FnPayload = {
  ok?: boolean
  error?: string
  user_message?: ObsidianMessage
  reply?: ObsidianMessage
  pending?: ObsidianMessage
  message?: ObsidianMessage
}

async function readInvokeError(
  error: { context?: Response; message?: string } | null,
  data: unknown,
): Promise<FnPayload | null> {
  let payload = (data || null) as FnPayload | null
  if (error) {
    const ctx = error.context
    if (ctx && typeof ctx.json === 'function') {
      try {
        payload = (await ctx.json()) as FnPayload
      } catch {
        /* keep */
      }
    }
    if (!payload?.error && !payload?.ok) {
      return { ok: false, error: error.message || 'Request failed' }
    }
  }
  return payload
}

export async function listObsidianThreads(): Promise<{
  data: ObsidianThread[] | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('obsidian_threads')
    .select('id, title, created_by, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as ObsidianThread[], error: null }
}

export async function createObsidianThread(title = 'New thread'): Promise<{
  data: ObsidianThread | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('obsidian_threads')
    .insert({ title })
    .select('id, title, created_by, created_at, updated_at')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as ObsidianThread, error: null }
}

export async function listObsidianMessages(threadId: string): Promise<{
  data: ObsidianMessage[] | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('obsidian_messages')
    .select('id, thread_id, role, content, status, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) return { data: null, error: error.message }
  return { data: (data ?? []) as ObsidianMessage[], error: null }
}

function mergeMessages(existing: ObsidianMessage[], incoming: ObsidianMessage[]): ObsidianMessage[] {
  const byId = new Map(existing.map((row) => [row.id, row]))
  for (const row of incoming) byId.set(row.id, row)
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export async function invokeObsidianChat(input: {
  threadId: string
  content: string
}): Promise<{ ok: true; messages: ObsidianMessage[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('obsidian-chat', {
      body: { thread_id: input.threadId, content: input.content },
    })
    const payload = await readInvokeError(error, data)
    if (!payload?.ok) {
      return { ok: false, error: payload?.error || 'obsidian-chat failed' }
    }
    const messages = [payload.user_message, payload.reply].filter(Boolean) as ObsidianMessage[]
    return { ok: true, messages }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function invokeObsidianHandoff(input: {
  threadId: string
  content: string
  route: ObsidianCrewRoute
}): Promise<{ ok: true; messages: ObsidianMessage[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('obsidian-handoff', {
      body: { thread_id: input.threadId, content: input.content, route: input.route },
    })
    const payload = await readInvokeError(error, data)
    if (!payload?.ok) {
      return { ok: false, error: payload?.error || 'obsidian-handoff failed' }
    }
    const messages = [payload.user_message, payload.pending].filter(Boolean) as ObsidianMessage[]
    return { ok: true, messages }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function subscribeObsidianMessages(
  threadId: string,
  onChange: (message: ObsidianMessage, event: 'INSERT' | 'UPDATE' | 'DELETE') => void,
): RealtimeChannel {
  return supabase
    .channel(`obsidian-messages-${threadId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'obsidian_messages',
        filter: `thread_id=eq.${threadId}`,
      },
      (payload) => {
        const event = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE'
        if (event === 'DELETE') {
          const oldRow = payload.old as Partial<ObsidianMessage>
          if (oldRow?.id) {
            onChange(
              {
                id: oldRow.id,
                thread_id: threadId,
                role: (oldRow.role as ObsidianRole) || 'ace',
                content: oldRow.content ?? '',
                status: (oldRow.status as ObsidianMessageStatus | null) ?? null,
                created_at: oldRow.created_at ?? '',
              },
              'DELETE',
            )
          }
          return
        }
        const row = payload.new as ObsidianMessage
        if (row?.id) onChange(row, event)
      },
    )
    .subscribe()
}

export function unsubscribeObsidianMessages(channel: RealtimeChannel): void {
  void supabase.removeChannel(channel)
}

export function applyRealtimeMessage(
  existing: ObsidianMessage[],
  message: ObsidianMessage,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
): ObsidianMessage[] {
  if (event === 'DELETE') {
    return existing.filter((row) => row.id !== message.id)
  }
  return mergeMessages(existing, [message])
}

export { mergeMessages }
