import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { requireAdmin, isAdminCaller, requireEnv, serviceClient } from '../_shared/admin.ts'
import { jsonResponse, optionsResponse } from '../_shared/cors.ts'
import { crewDecisionPayload, signCrewDecision } from '../_shared/crewSign.ts'

// Approve/Deny from Obsidian Team. Only a signed-in admin user may decide: the internal app's
// service role key is in its binary, so a service_role caller is refused here. The decision row is
// HMAC-signed with CREW_DECISION_SECRET, which only this function and the Claude Crew Mac app know;
// the Mac ignores rows without a valid signature.

type DecideBody = {
  action_id?: string
  decision?: string
  confirm?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse()
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST only' }, 405)
  }

  const admin = await requireAdmin(req)
  if (!isAdminCaller(admin)) return admin
  if (admin.via !== 'user_jwt' || !admin.userId) {
    return jsonResponse({ ok: false, error: 'Sign in again to approve. Approvals need your admin sign-in.' }, 401)
  }

  const secret = requireEnv('CREW_DECISION_SECRET')
  if (secret instanceof Response) return secret

  let body: DecideBody
  try {
    body = (await req.json()) as DecideBody
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be JSON.' }, 400)
  }

  const actionId = String(body.action_id ?? '').trim()
  const decision = String(body.decision ?? '').trim()
  const confirm = body.confirm === true
  if (!actionId || actionId.length > 200) {
    return jsonResponse({ ok: false, error: 'action_id is required.' }, 400)
  }
  if (decision !== 'approve' && decision !== 'deny') {
    return jsonResponse({ ok: false, error: 'decision must be approve or deny.' }, 400)
  }

  const db = serviceClient()
  const { data: action, error: actionError } = await db
    .from('crew_actions')
    .select('id, bot_id, status')
    .eq('id', actionId)
    .maybeSingle()
  if (actionError) return jsonResponse({ ok: false, error: actionError.message }, 500)
  if (!action) return jsonResponse({ ok: false, error: 'No such action.' }, 404)
  if (action.status !== 'pending' && action.status !== 'confirm') {
    return jsonResponse({ ok: false, error: `Already ${action.status}.` }, 409)
  }

  const id = crypto.randomUUID()
  const signature = await signCrewDecision(
    secret,
    crewDecisionPayload({ id, action_id: action.id, bot_id: action.bot_id, decision, confirm }),
  )
  const { data: row, error } = await db
    .from('crew_decisions')
    .insert({ id, action_id: action.id, bot_id: action.bot_id, decision, confirm, decided_by: admin.userId, signature })
    .select('id, action_id, decision, confirm, created_at')
    .single()
  if (error) return jsonResponse({ ok: false, error: error.message }, 500)

  return jsonResponse({ ok: true, decision: row })
})
