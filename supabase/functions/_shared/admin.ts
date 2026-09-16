import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { jsonResponse } from './cors.ts'

/** Matches src/lib/adminAuth.ts ADMIN_EMAIL. */
export const INTERNAL_ADMIN_EMAIL = 'dev@afaantech.com'

type JwtPayload = {
  role?: string
  email?: string
  sub?: string
}

export type AdminCaller = {
  userId: string | null
  email: string | null
  via: 'user_jwt' | 'service_role'
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  return token || null
}

export function requireEnv(name: string): string | Response {
  const value = Deno.env.get(name)?.trim() ?? ''
  if (!value) {
    return jsonResponse(
      {
        ok: false,
        error: `${name} is not set on this Edge Function. Add it in Supabase → Edge Functions → Secrets.`,
      },
      500,
    )
  }
  return value
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing on Edge runtime.')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/**
 * Admin JWT for obsidian-chat / obsidian-handoff.
 * Accepts the internal app's service_role JWT (same supabase client as other admin invokes)
 * or a signed-in user JWT whose email is ADMIN_EMAIL.
 */
export async function requireAdmin(req: Request): Promise<AdminCaller | Response> {
  const token = bearerToken(req)
  if (!token) {
    return jsonResponse(
      {
        ok: false,
        error:
          'Missing Authorization Bearer JWT. Call via supabase.functions.invoke from the signed-in admin app (same client as other Edge calls).',
      },
      401,
    )
  }

  const claims = decodeJwtPayload(token)
  if (claims?.role === 'service_role') {
    return { userId: null, email: INTERNAL_ADMIN_EMAIL, via: 'service_role' }
  }
  if (claims?.role === 'anon') {
    return jsonResponse(
      {
        ok: false,
        error:
          'Anon key JWT is not enough. Call via supabase.functions.invoke from the internal admin client (service role or signed-in admin JWT).',
      },
      401,
    )
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!url || !anon) {
    return jsonResponse(
      { ok: false, error: 'SUPABASE_URL or SUPABASE_ANON_KEY missing on Edge runtime.' },
      500,
    )
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser(token)
  if (error || !data.user) {
    return jsonResponse(
      {
        ok: false,
        error: error?.message || 'Invalid or expired admin JWT. Sign in again, then retry.',
      },
      401,
    )
  }

  const email = (data.user.email ?? claims?.email ?? '').trim().toLowerCase()
  if (email !== INTERNAL_ADMIN_EMAIL) {
    return jsonResponse(
      { ok: false, error: `Not an admin user (${email || 'no email'}). Obsidian is admin-only.` },
      403,
    )
  }

  return { userId: data.user.id, email, via: 'user_jwt' }
}

export function isAdminCaller(value: AdminCaller | Response): value is AdminCaller {
  return !(value instanceof Response)
}
