import { CREW_HANDLES_BLOCK } from './obsidianCrew.ts'
import { CREW_ROUTES, isCrewRoute, type AceRoute } from './obsidian.ts'

export type ObsidianSendDecision =
  | { action: 'chat' }
  | { action: 'handoff'; route: AceRoute }

export const OBSIDIAN_ROUTE_SYSTEM = `You route Obsidian desk messages. Reply with JSON only.
{"action":"chat"} if Obsidian can think, draft, explain, plan, answer, or look up product data with SQL.
{"action":"handoff","route":"ace"|"moti"|"jack"|"queen"|"nigus"} if the user wants a specialized agent to execute work.
Do not hand off analytics lookups — Obsidian can run read-only SQL.
Crew:
${CREW_HANDLES_BLOCK}
Default handoff route is ace when the user asks to assign work without naming someone.`

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
  const wantsJob =
    /\b(give this to|hand (this|it) (off )?to|hand off|assign (this|it)|job for|delegate|have \w+ review|turn this (conversation|thread) into a job)\b/.test(
      t,
    )
  for (const route of CREW_ROUTES) {
    if (
      new RegExp(`(?:^|\\s)@${route}\\b`).test(t) ||
      t.includes(`hand to ${route}`) ||
      t.includes(`give this to ${route}`) ||
      t.includes(`ask ${route}`) ||
      t.includes(`have ${route}`) ||
      t.includes(`job for ${route}`) ||
      t.includes(`talk to ${route}`)
    ) {
      return { action: 'handoff', route }
    }
  }
  if (wantsJob) return { action: 'handoff', route: 'ace' }
  return { action: 'chat' }
}
