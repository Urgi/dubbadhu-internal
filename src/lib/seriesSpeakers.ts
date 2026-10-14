/**
 * Speaker names for a series, in first-seen order: dialogue person1 / person2,
 * then `saidBy` on speaking / exposure rows ("Hawwii/Kennaa" counts as both).
 */
export function collectSeriesSpeakerNames(lessonContents: unknown[]): string[] {
  const seen = new Map<string, string>()
  const add = (raw: unknown) => {
    for (const part of String(raw ?? '').split('/')) {
      const name = part.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) seen.set(key, name)
    }
  }

  for (const raw of lessonContents) {
    let content: unknown = raw
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content)
      } catch {
        continue
      }
    }
    const screens = Array.isArray(content)
      ? content
      : Array.isArray((content as { screens?: unknown })?.screens)
        ? (content as { screens: unknown[] }).screens
        : []
    for (const screen of screens) {
      const sc = screen as { type?: string; content?: Record<string, unknown> }
      const co = sc?.content
      if (!co || typeof co !== 'object') continue
      if (sc.type === 'dialogue') {
        const dd = co.dialogueData as { person1?: { name?: unknown }; person2?: { name?: unknown } } | undefined
        add(dd?.person1?.name)
        add(dd?.person2?.name)
      }
      add(co.saidBy)
      for (const listKey of ['words', 'phrases']) {
        const list = co[listKey]
        if (Array.isArray(list)) {
          for (const row of list) add((row as { saidBy?: unknown })?.saidBy)
        }
      }
    }
  }
  return [...seen.values()]
}

/** Keep only non-empty https/http string values. */
export function normalizeSpeakerPhotos(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [name, url] of Object.entries(raw as Record<string, unknown>)) {
    const n = name.trim()
    const u = typeof url === 'string' ? url.trim() : ''
    if (n && /^https?:\/\//i.test(u)) out[n] = u
  }
  return out
}
