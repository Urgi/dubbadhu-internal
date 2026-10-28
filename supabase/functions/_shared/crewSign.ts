// Signature for Obsidian Team approvals. ~/dev/claude-crew/relay.mjs checks the same payload
// with the same CREW_DECISION_SECRET; keep the two in sync.

export type CrewDecisionFields = {
  id: string
  action_id: string
  bot_id: string
  decision: string
  confirm: boolean
}

export function crewDecisionPayload(d: CrewDecisionFields): string {
  return ['crew-decision-v1', d.id, d.action_id, d.bot_id, d.decision, d.confirm ? '1' : '0'].join('|')
}

export async function signCrewDecision(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
