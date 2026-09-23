import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { OBSIDIAN_CREW_ROUTES, type ObsidianCrewRoute, type ObsidianRole } from './obsidian'

export type { ObsidianCrewRoute }

export const OBSIDIAN_CREW: Record<
  ObsidianCrewRoute,
  { name: string; handles: string; color: string }
> = {
  ace: {
    name: 'Ace',
    handles: 'Pipeline, PM, status, scope, scheduling, and product planning',
    color: ADMIN_ACCENT_GOLD,
  },
  moti: {
    name: 'Moti',
    handles: 'Afaan Oromo content. Professor and voice-actor review still own the lesson.',
    color: '#f9a8d4',
  },
  jack: {
    name: 'Jack',
    handles: 'Engineering: repo/code clarity, bugs, friends, mic, OTP, instrumentation',
    color: '#86efac',
  },
  queen: {
    name: 'Queen',
    handles: 'Marketing and paywall framing',
    color: '#c4b5fd',
  },
  nigus: {
    name: 'Nigus',
    handles: 'Amharic content',
    color: '#fdba74',
  },
}

export const OBSIDIAN_ROLE_COLOR: Record<ObsidianRole, string> = {
  user: '#e5e7eb',
  chatgpt: '#93c5fd',
  ace: OBSIDIAN_CREW.ace.color,
  moti: OBSIDIAN_CREW.moti.color,
  jack: OBSIDIAN_CREW.jack.color,
  queen: OBSIDIAN_CREW.queen.color,
  nigus: OBSIDIAN_CREW.nigus.color,
}

export function crewDisplayName(route: ObsidianCrewRoute): string {
  return OBSIDIAN_CREW[route].name
}

export function isCrewRouteName(value: string): value is ObsidianCrewRoute {
  return (OBSIDIAN_CREW_ROUTES as readonly string[]).includes(value)
}

export const OBSIDIAN_CREW_LIST = OBSIDIAN_CREW_ROUTES.map((id) => ({
  id,
  ...OBSIDIAN_CREW[id],
}))
