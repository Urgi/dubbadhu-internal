import { CREW_HANDLES_BLOCK } from './obsidianCrew.ts'
import { CREW_ROUTES, isCrewRoute, type AceRoute } from './obsidian.ts'

export type ObsidianSendDecision =
  | { action: 'chat' }
  | { action: 'handoff'; route: AceRoute }

export const OBSIDIAN_ROUTE_SYSTEM = `You route Obsidian desk messages. Reply with JSON only.
{"action":"chat"} if Obsidian can think, draft, explain, plan, answer from product facts, or look up data with SQL.
{"action":"handoff","route":"ace"|"moti"|"jack"|"queen"|"nigus"} when a specialized agent should execute or dig into work Obsidian cannot see.
Analytics and data follow-ups stay chat. Counts, retention, funnels, "how many", "give me the user", "who submitted", and other SQL lookups are not jobs.
Jack: repo or code clarity (how it is implemented, read the codebase), plus eng bugs (mic, OTP, friends invite, instrumentation).
Ace: scheduling, product planning, pipeline, PM, status, and scope. Not analytics or sentence/user lookups.
Unnamed "assign this" stays ace. Afaan content is moti. Amharic content is nigus. Marketing and paywall framing is queen.
Do not hand off a lookup. Do not invent language truth.
Crew:
${CREW_HANDLES_BLOCK}`

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

const UNNAMED_JOB =
  /\b(give this to|hand (this|it) (off )?to|hand off|assign (this|it)|job for|delegate|have \w+ review|turn this (conversation|thread) into a job)\b/

const ANALYTICS_LOOKUP =
  /\b(how many|how much|count of|number of|retention|funnel|conversion|cohort|breakdown|percent|percentage|what(?:'s| is) the (?:rate|number|count)|last \d+ days|over the last|this week|analytics)\b/i

const DATA_FOLLOWUP =
  /\b(give me the user|who submitted|who wrote|which user|find the user|user of (?:the )?sentence|author of|look up (?:the )?user|show (?:me )?(?:the )?user|sentence user)\b/i

const JACK_DOMAIN =
  /\b(friends?(?:\s+invite)?|not_found|microphone|\bmic\b|otp|one-time password|instrumentation|signin_failed)\b/i

const JACK_EXECUTE =
  /\b(bug|crash|broken|regression|debug|fix|instrument|not working|doesn'?t work|failing)\b/i

const JACK_REPO =
  /\b(codebase|source code|github|repo|repository|in the code|from the code|look at the code|read the code|how (?:is|does|do).{0,80}implement|implementation of|where in (?:the )?(?:code|repo|codebase))\b/i

const ACE_PRODUCT =
  /\b(schedul(?:e|ing)|roadmap|priorit(?:y|ies|ize|ise)|product (?:plan|planning|decision|call|scope)|what should we (?:ship|build|do next)|pipeline status|scope (?:this|for)|pm (?:call|decision)|release plan)\b/i

export function explicitCrewRoute(text: string): AceRoute | null {
  const t = text.toLowerCase()
  for (const route of CREW_ROUTES) {
    if (
      new RegExp(`(?:^|\\s)@${route}\\b`).test(t) ||
      t.includes(`hand to ${route}`) ||
      t.includes(`give this to ${route}`) ||
      t.includes(`ask ${route}`) ||
      t.includes(`have ${route}`) ||
      t.includes(`job for ${route}`) ||
      t.includes(`talk to ${route}`) ||
      t.includes(`send this to ${route}`) ||
      t.includes(`send it to ${route}`)
    ) {
      return route
    }
  }
  return null
}

export function isAnalyticsLookup(text: string): boolean {
  return ANALYTICS_LOOKUP.test(text) || DATA_FOLLOWUP.test(text)
}

function looksLikeJackEngJob(text: string): boolean {
  return JACK_DOMAIN.test(text) && JACK_EXECUTE.test(text)
}

function looksLikeJackRepoJob(text: string): boolean {
  return JACK_REPO.test(text)
}

function looksLikeAceProductJob(text: string): boolean {
  return ACE_PRODUCT.test(text)
}

function wantsUnnamedJob(text: string): boolean {
  return UNNAMED_JOB.test(text.toLowerCase())
}

function modelHandoffIsTrusted(model: Extract<ObsidianSendDecision, { action: 'handoff' }>, content: string): boolean {
  if (model.route === 'moti' || model.route === 'nigus' || model.route === 'queen') return true
  if (wantsUnnamedJob(content)) return true
  if (model.route === 'ace' && looksLikeAceProductJob(content)) return true
  if (model.route === 'jack' && (looksLikeJackRepoJob(content) || looksLikeJackEngJob(content))) return true
  return false
}

export function resolveObsidianSendDecision(
  content: string,
  model: ObsidianSendDecision | null,
): ObsidianSendDecision {
  const mentioned = explicitCrewRoute(content)
  if (mentioned) return { action: 'handoff', route: mentioned }
  if (looksLikeJackRepoJob(content) || looksLikeJackEngJob(content)) {
    return { action: 'handoff', route: 'jack' }
  }
  if (looksLikeAceProductJob(content)) return { action: 'handoff', route: 'ace' }
  if (isAnalyticsLookup(content)) return { action: 'chat' }
  if (model?.action === 'handoff') {
    return modelHandoffIsTrusted(model, content) ? model : { action: 'chat' }
  }
  if (model) return model
  if (wantsUnnamedJob(content)) return { action: 'handoff', route: 'ace' }
  return { action: 'chat' }
}

export function heuristicObsidianSendDecision(text: string): ObsidianSendDecision {
  return resolveObsidianSendDecision(text, null)
}
