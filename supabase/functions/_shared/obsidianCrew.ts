import { CREW_ROUTES, type AceRoute } from './obsidian.ts'

export const CREW_HANDLES: Record<AceRoute, { name: string; handles: string }> = {
  ace: { name: 'Ace', handles: 'Engineering: Cursor, git, EAS, deploys, schema' },
  moti: { name: 'Moti', handles: 'Afaan Oromo language, lesson copy, cultural review' },
  jack: { name: 'Jack', handles: 'Product ops, plans, and follow-through' },
  queen: { name: 'Queen', handles: 'Social rollout, content, and community' },
  nigus: { name: 'Nigus', handles: 'Strategy and executive decisions' },
}

export const CREW_HANDLES_BLOCK = CREW_ROUTES.map(
  (id) => `- ${id}: ${CREW_HANDLES[id].name} — ${CREW_HANDLES[id].handles}`,
).join('\n')
