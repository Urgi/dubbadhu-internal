import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireEnv, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import { secretEquals } from '../_shared/obsidian.ts'

type PurgeBody = {
  dry_run?: boolean
}

function presentedSecret(req: Request): string {
  const headerKey = req.headers.get('x-obsidian-purge-key')?.trim() ?? ''
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

  const expected = requireEnv('OBSIDIAN_PURGE_SECRET')
  if (expected instanceof Response) return expected

  const received = presentedSecret(req)
  if (!received || !secretEquals(expected, received)) {
    return jsonResponse(
      {
        ok: false,
        error:
          'Missing or invalid OBSIDIAN_PURGE_SECRET. Send x-obsidian-purge-key or Authorization: Bearer <secret>.',
      },
      401,
    )
  }

  let dryRun = false
  const raw = await req.text()
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as PurgeBody
      dryRun = body.dry_run === true
    } catch {
      return jsonResponse({ ok: false, error: 'Body must be JSON.' }, 400)
    }
  }

  const db = serviceClient()
  const { data, error } = await db.rpc('obsidian_purge_stale_threads', { p_dry_run: dryRun })
  if (error) {
    console.log(JSON.stringify({ event: 'obsidian_purge_stale', ok: false, error: error.message }))
    return jsonResponse({ ok: false, error: error.message }, 500)
  }

  const result = (data ?? {}) as { dry_run?: boolean; deleted?: number; matched?: number; thread_ids?: string[] }
  console.log(
    JSON.stringify({
      event: 'obsidian_purge_stale',
      ok: true,
      dry_run: result.dry_run === true,
      deleted: result.deleted ?? 0,
      matched: result.matched ?? 0,
    }),
  )

  return jsonResponse({ ok: true, ...result })
})
