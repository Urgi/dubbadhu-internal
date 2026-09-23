export const OBSIDIAN_THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function threadLastActivityMs(updatedAt: string, latestMessageAt: string | null): number {
  const updated = Date.parse(updatedAt)
  const message = latestMessageAt ? Date.parse(latestMessageAt) : Number.NaN
  const updatedMs = Number.isFinite(updated) ? updated : 0
  const messageMs = Number.isFinite(message) ? message : 0
  return Math.max(updatedMs, messageMs)
}

export function shouldPurgeObsidianThread(input: {
  keep: boolean
  updatedAt: string
  latestMessageAt: string | null
  nowMs: number
}): boolean {
  if (input.keep) return false
  const last = threadLastActivityMs(input.updatedAt, input.latestMessageAt)
  if (last <= 0) return false
  return input.nowMs - last > OBSIDIAN_THREAD_TTL_MS
}
