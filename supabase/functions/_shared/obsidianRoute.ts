import { ACE_WEBHOOK_URL, CREW_ROUTES, isCrewRoute, type AceRoute } from './obsidian.ts'

export type ObsidianSendDecision =
  | { action: 'chat' }
  | { action: 'handoff'; route: AceRoute }

export const OBSIDIAN_ROUTE_SYSTEM = `You route Obsidian desk messages. Reply with JSON only.
{"action":"chat"} if ChatGPT can think, draft, explain, plan, answer, or look up product data with SQL.
{"action":"handoff","route":"ace"|"moti"|"jack"|"queen"|"nigus"} if a person must do real work.
- ace: engineering, Cursor, git, EAS, deploys, schema changes — not analytics lookups
- moti, jack, queen, nigus: only when the user names that person or their work
Analytics, funnels, retention, user counts, event questions stay as chat. Obsidian can run read-only SQL.
Default handoff route is ace.`

export function parseObsidianSendDecision(raw: string): ObsidianSendDecision | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { action?: string; route?: string }
    if (parsed.action === 'chat') return { action: 'chat' }
    if (parsed.action === 'handoff') {
      const route = String(parsed.route ?? 'ace').trim()
      if (isCrewRoute(route)) return { action: 'handoff', route }
      return { action: 'handoff', route: 'ace' }
    }
  } catch {
    return null
  }
  return null
}

export function heuristicObsidianSendDecision(text: string): ObsidianSendDecision {
  const t = text.toLowerCase()
  for (const route of CREW_ROUTES) {
    if (
      new RegExp(`(?:^|\\s)@${route}\\b`).test(t) ||
      t.includes(`hand to ${route}`) ||
      t.includes(`ask ${route}`) ||
      t.includes(`talk to ${route}`)
    ) {
      return { action: 'handoff', route }
    }
  }
  if (
    /\b(deploy|eas build|git push|open a pr|pull request|migration|supabase db|xcode|gradle|ci\/cd|production build)\b/i.test(
      text,
    )
  ) {
    return { action: 'handoff', route: 'ace' }
  }
  return { action: 'chat' }
}
