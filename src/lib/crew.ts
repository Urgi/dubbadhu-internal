import * as FileSystem from 'expo-file-system/legacy'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import supabase from './supabase'
import { getExpoPublicSupabaseAnonKey, getExpoPublicSupabaseUrl } from './expoPublicEnv'

// Obsidian Team: chats with the Claude Crew bots that run on Urgi's Mac (~/dev/claude-crew).
// The Mac mirrors each chat into the crew_* tables (sql/crew.sql). Messages sent here are queued
// and run when the Mac is awake. Approvals go through crew-decide, which needs the admin sign-in.

export type CrewShape = 'round' | 'square' | 'triangle' | 'cloud'

export type CrewBot = {
  id: string
  name: string
  color: string
  shape: CrewShape
  mode: string
  sort: number
  busy: boolean
  waiting: number
  last_role: 'user' | 'assistant' | null
  last_text: string | null
  last_at: string | null
  mac_seen_at: string | null
}

export type CrewMessage = {
  id: string
  bot_id: string
  role: 'user' | 'assistant'
  text: string
  tools: string[]
  action_ids: string[]
  note: string | null
  source: 'mac' | 'phone' | 'routine'
  routine: string | null
  add_on: boolean
  status: 'queued' | 'taken' | 'failed' | null
  created_at: string
}

export type CrewActionStatus = 'pending' | 'confirm' | 'approved' | 'denied' | 'done' | 'failed' | 'expired'

export type CrewAction = {
  id: string
  bot_id: string
  tool: string | null
  title: string
  command: string | null
  target: string | null
  environment: string | null
  danger: string | null
  reason: string | null
  preview: { sql?: string; new?: string; edits?: { old?: string; new?: string }[] } | null
  status: CrewActionStatus
  output: string | null
  created_at: string
}

export type CrewChat = { messages: CrewMessage[]; actions: Record<string, CrewAction> }

/** The Mac refreshes mac_seen_at every 30s while Claude Crew is running. */
const MAC_AWAKE_MS = 90_000
const CHAT_LIMIT = 300

export function macLastSeen(bots: CrewBot[]): number {
  return Math.max(0, ...bots.map((b) => (b.mac_seen_at ? Date.parse(b.mac_seen_at) : 0)))
}

export function isMacAwake(bots: CrewBot[]): boolean {
  return Date.now() - macLastSeen(bots) < MAC_AWAKE_MS
}

export const CREW_ACTION_STATUS_LABEL: Record<CrewActionStatus, string> = {
  pending: 'Waiting for you',
  confirm: 'Approved once. Confirm again to run it.',
  approved: 'Approved, running…',
  done: 'Approved and done',
  failed: 'Approved, but it failed',
  denied: 'Denied',
  expired: 'Expired',
}

// ---------- on-device cache (chats stay readable when the Mac or the network is away) ----------

type CrewCache = {
  bots: CrewBot[]
  chats: Record<string, CrewChat>
  lastRead: Record<string, string>
}

const CACHE_FILE = 'obsidian_team_cache.json'
let memoryCache: CrewCache | null = null

function cachePath(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${CACHE_FILE}` : null
}

export async function readCrewCache(): Promise<CrewCache> {
  if (memoryCache) return memoryCache
  const empty: CrewCache = { bots: [], chats: {}, lastRead: {} }
  try {
    const path = cachePath()
    if (!path) return (memoryCache = empty)
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return (memoryCache = empty)
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as Partial<CrewCache>
    memoryCache = { bots: parsed.bots ?? [], chats: parsed.chats ?? {}, lastRead: parsed.lastRead ?? {} }
  } catch (e) {
    console.warn('[crew] Failed to read cache:', e)
    memoryCache = empty
  }
  return memoryCache
}

async function writeCrewCache(update: (cache: CrewCache) => void): Promise<void> {
  const cache = await readCrewCache()
  update(cache)
  try {
    const path = cachePath()
    if (path) await FileSystem.writeAsStringAsync(path, JSON.stringify(cache))
  } catch (e) {
    console.warn('[crew] Failed to write cache:', e)
  }
}

export async function markCrewRead(botId: string, at: string): Promise<void> {
  await writeCrewCache((c) => {
    if (!c.lastRead[botId] || c.lastRead[botId] < at) c.lastRead[botId] = at
  })
}

export function isCrewUnread(bot: CrewBot, lastRead: Record<string, string>): boolean {
  return bot.last_role === 'assistant' && !!bot.last_at && (!lastRead[bot.id] || lastRead[bot.id] < bot.last_at)
}

// ---------- reads ----------

export async function listCrewBots(): Promise<{ data: CrewBot[]; error: string | null; cached: boolean }> {
  const { data, error } = await supabase.from('crew_bots').select('*').order('sort')
  if (error) {
    const cache = await readCrewCache()
    return { data: cache.bots, error: error.message, cached: true }
  }
  const bots = (data ?? []) as CrewBot[]
  await writeCrewCache((c) => {
    c.bots = bots
  })
  return { data: bots, error: null, cached: false }
}

export async function loadCrewChat(
  botId: string,
): Promise<{ data: CrewChat; error: string | null; cached: boolean }> {
  const [msgs, acts] = await Promise.all([
    supabase
      .from('crew_messages')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false })
      .limit(CHAT_LIMIT),
    supabase
      .from('crew_actions')
      .select('*')
      .eq('bot_id', botId)
      .order('created_at', { ascending: false })
      .limit(CHAT_LIMIT),
  ])
  const error = msgs.error?.message ?? acts.error?.message ?? null
  if (error) {
    const cache = await readCrewCache()
    return { data: cache.chats[botId] ?? { messages: [], actions: {} }, error, cached: true }
  }
  const chat: CrewChat = {
    messages: ((msgs.data ?? []) as CrewMessage[]).reverse(),
    actions: Object.fromEntries(((acts.data ?? []) as CrewAction[]).map((a) => [a.id, a])),
  }
  await writeCrewCache((c) => {
    c.chats[botId] = chat
  })
  return { data: chat, error: null, cached: false }
}

/** Live updates for the crew tables. Returns an unsubscribe function. */
export function subscribeCrew(
  onChange: (table: 'crew_bots' | 'crew_messages' | 'crew_actions', row: Record<string, unknown>) => void,
  botId?: string,
): () => void {
  const filter = botId ? `bot_id=eq.${botId}` : undefined
  let channel: RealtimeChannel = supabase.channel(`obsidian-team-${botId ?? 'all'}-${Date.now()}`)
  channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'crew_bots' }, (p) =>
    onChange('crew_bots', p.new as Record<string, unknown>),
  )
  if (botId) {
    channel = channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_messages', filter }, (p) =>
        onChange('crew_messages', p.new as Record<string, unknown>),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_actions', filter }, (p) =>
        onChange('crew_actions', p.new as Record<string, unknown>),
      )
  }
  channel.subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}

// ---------- writes ----------

export async function sendCrewMessage(
  botId: string,
  text: string,
): Promise<{ data: CrewMessage | null; error: string | null }> {
  const trimmed = text.trim()
  if (!trimmed) return { data: null, error: 'Type a message first.' }
  const { data, error } = await supabase
    .from('crew_messages')
    .insert({ bot_id: botId, role: 'user', text: trimmed, source: 'phone', status: 'queued' })
    .select('*')
    .single()
  if (error) return { data: null, error: error.message }
  return { data: data as CrewMessage, error: null }
}

// ---------- admin sign-in for approvals ----------

type CrewSession = { access_token: string; refresh_token: string; expires_at: number }

const SESSION_FILE = 'obsidian_team_auth.json'

const authClient = createClient(
  getExpoPublicSupabaseUrl() || 'https://placeholder.supabase.co',
  getExpoPublicSupabaseAnonKey() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.e',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

function sessionPath(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${SESSION_FILE}` : null
}

/** Called after the admin email code is verified, so approvals can prove they came from Urgi. */
export async function saveCrewSession(session: {
  access_token: string
  refresh_token: string
  expires_at?: number
} | null): Promise<void> {
  try {
    const path = sessionPath()
    if (!path || !session) return
    const stored: CrewSession = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    }
    await FileSystem.writeAsStringAsync(path, JSON.stringify(stored))
  } catch (e) {
    console.warn('[crew] Failed to save sign-in:', e)
  }
}

export async function clearCrewSession(): Promise<void> {
  try {
    const path = sessionPath()
    if (path) await FileSystem.deleteAsync(path, { idempotent: true })
  } catch (e) {
    console.warn('[crew] Failed to clear sign-in:', e)
  }
}

export async function crewAccessToken(): Promise<string | null> {
  try {
    const path = sessionPath()
    if (!path) return null
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return null
    const stored = JSON.parse(await FileSystem.readAsStringAsync(path)) as CrewSession
    if (stored.expires_at - 60 > Date.now() / 1000) return stored.access_token
    const { data, error } = await authClient.auth.refreshSession({ refresh_token: stored.refresh_token })
    if (error || !data.session) {
      await clearCrewSession()
      return null
    }
    await saveCrewSession(data.session)
    return data.session.access_token
  } catch (e) {
    console.warn('[crew] Failed to load sign-in:', e)
    return null
  }
}

export async function decideCrewAction(
  actionId: string,
  decision: 'approve' | 'deny',
  confirm = false,
): Promise<{ ok: boolean; error?: string; needsSignIn?: boolean }> {
  const token = await crewAccessToken()
  if (!token) return { ok: false, needsSignIn: true, error: 'Approvals need your admin sign-in.' }
  try {
    const res = await fetch(`${getExpoPublicSupabaseUrl()}/functions/v1/crew-decide`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: getExpoPublicSupabaseAnonKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action_id: actionId, decision, confirm }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (res.status === 401) {
      await clearCrewSession()
      return { ok: false, needsSignIn: true, error: body.error || 'Sign in again to approve.' }
    }
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `Request failed (${res.status})` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error.' }
  }
}
