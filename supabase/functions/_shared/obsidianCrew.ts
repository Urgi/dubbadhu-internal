import { CREW_ROUTES, type AceRoute } from './obsidian.ts'

export const CREW_HANDLES: Record<AceRoute, { name: string; handles: string }> = {
  ace: { name: 'Ace', handles: 'Pipeline, PM, status, and scope' },
  moti: { name: 'Moti', handles: 'Afaan Oromo content. Professor and voice-actor review still own the lesson.' },
  jack: { name: 'Jack', handles: 'Engineering: bugs, friends, mic, OTP, instrumentation' },
  queen: { name: 'Queen', handles: 'Marketing and paywall framing' },
  nigus: { name: 'Nigus', handles: 'Amharic content' },
}

export const CREW_HANDLES_BLOCK = CREW_ROUTES.map(
  (id) => `- ${id}: ${CREW_HANDLES[id].name} — ${CREW_HANDLES[id].handles}`,
).join('\n')
