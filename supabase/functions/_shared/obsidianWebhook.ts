import { ACE_WEBHOOK_URL, type AceRoute } from './obsidian.ts'

export type CrewWebhookEnv = {
  JACK_WEBHOOK_URL?: string
  JACK_WEBHOOK_KEY?: string
  ACE_WEBHOOK_KEY?: string
}

export type CrewWebhookTarget = {
  url: string
  key: string
  via: 'ace' | 'jack'
}

export function resolveCrewWebhook(
  route: AceRoute,
  env: CrewWebhookEnv,
): { ok: true; target: CrewWebhookTarget } | { ok: false; error: string } {
  if (route === 'jack') {
    const url = env.JACK_WEBHOOK_URL?.trim() ?? ''
    const key = env.JACK_WEBHOOK_KEY?.trim() ?? ''
    if (!url || !key) {
      return {
        ok: false,
        error: 'Jack handoff needs JACK_WEBHOOK_URL and JACK_WEBHOOK_KEY on the Edge Function.',
      }
    }
    return { ok: true, target: { url, key, via: 'jack' } }
  }
  const key = env.ACE_WEBHOOK_KEY?.trim() ?? ''
  if (!key) {
    return { ok: false, error: 'ACE_WEBHOOK_KEY is not set on this Edge Function.' }
  }
  return { ok: true, target: { url: ACE_WEBHOOK_URL, key, via: 'ace' } }
}
