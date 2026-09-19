import { createClient } from '@supabase/supabase-js'
import type { RecordingWord } from '../types'
import { normalizeRecordingWords } from './wordStatus'
import {
  getExpoPublicSupabaseAnonKey,
  getExpoPublicSupabaseUrl,
  getSupabaseServiceRoleKey,
} from './expoPublicEnv'

// Use EXPO_PUBLIC_* in .env; also mirrored in app.config.js → extra for native/Xcode embeds.
const SUPABASE_URL = getExpoPublicSupabaseUrl()
const SUPABASE_ANON_KEY = getExpoPublicSupabaseAnonKey()
const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey()

if (__DEV__ && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.warn(
    '[supabase] Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart Expo.',
  )
}

if (__DEV__ && !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabase] SUPABASE_SERVICE_ROLE_KEY missing — catalog/config writes will fail after RLS lockdown. Set it in .env (admin app only).',
  )
}

function describeSupabaseKeyRole(key: string): string {
  if (!key) return 'missing'
  if (key.startsWith('sb_publishable_') || key.startsWith('sb_publishable')) return 'publishable_anon'
  try {
    const payload = key.split('.')[1]
    if (!payload) return 'unknown'
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
    const json = JSON.parse(globalThis.atob(padded)) as { role?: string }
    return json.role || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Prefer service role so admin mutations work after anon write revoke. */
const clientKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY

if (__DEV__) {
  console.log(
    '[supabase] client key role=',
    describeSupabaseKeyRole(clientKey),
    'hasServiceRoleEnv=',
    Boolean(SUPABASE_SERVICE_ROLE_KEY),
  )
}

function createSupabaseClient() {
  if (!SUPABASE_URL || !clientKey) {
    console.error(
      '[supabase] Missing URL or key in this binary. Set EXPO_PUBLIC_SUPABASE_* on the EAS production profile.',
    )
    return createClient('https://placeholder.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.e', {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return createClient(SUPABASE_URL, clientKey)
}

const supabase = createSupabaseClient()

export const wordsQuery = () => supabase.from('words').select('*')

export const getWords = async () => {
  const { data, error } = await wordsQuery()
  return { data: data ? normalizeRecordingWords(data) : null, error }
}

export default supabase
