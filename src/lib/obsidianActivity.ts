export type ActivityItem = {
  done: boolean
  label: string
}

export type ActivitySummary = {
  title: string
  lede: string
  items: ActivityItem[]
  read: string
}

function stripMd(text: string): string {
  return text.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').trim()
}

function asItem(line: string): ActivityItem | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const missing = /^[—–-]\s+|^(no |not |hasn't |has not )/i.test(trimmed) || /yet\s*$/i.test(trimmed)
  const doneMark = /^(✓|✔|✅)\s+/.test(trimmed) || /^[-*]\s+(✓|✔)/.test(trimmed)
  const label = stripMd(
    trimmed
      .replace(/^(✓|✔|✅)\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^[—–]\s+/, ''),
  )
  if (!label) return null
  return { done: doneMark || (!missing && !/^no /i.test(label)), label }
}

export function parseActivitySummary(markdown: string): ActivitySummary | null {
  const text = markdown.trim()
  if (!text) return null
  const looksActivity =
    /\b(signup|otp|lesson|activity|viewed|verified|requested)\b/i.test(text) &&
    (/\n[-*]|\n\d+\.|✓|ACTIVITY/i.test(text) || text.split('\n').length >= 4)
  if (!looksActivity) return null

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  let title = ''
  let lede = ''
  const items: ActivityItem[] = []
  let read = ''
  let section: 'top' | 'activity' | 'read' = 'top'

  for (const line of lines) {
    const heading = stripMd(line)
    if (/^activity$/i.test(heading) || /^##?\s*activity/i.test(line)) {
      section = 'activity'
      continue
    }
    if (/obsidian.?s read|interpretation|read$/i.test(heading)) {
      section = 'read'
      continue
    }
    if (section === 'read') {
      read = read ? `${read} ${stripMd(line)}` : stripMd(line)
      continue
    }
    if (
      section === 'activity' ||
      /^(✓|✔|[-*]|\d+\.|—)/.test(line) ||
      /^(viewed|requested|verified|completed|started|no lesson)/i.test(heading)
    ) {
      section = 'activity'
      const item = asItem(line)
      if (item) items.push(item)
      continue
    }
    if (!title && (/^#\s+/.test(line) || /^\*\*.+\*\*$/.test(line) || heading.length < 80)) {
      title = heading
      continue
    }
    if (!lede) {
      lede = stripMd(line)
      continue
    }
    if (!read && !/^(✓|[-*])/.test(line)) {
      read = stripMd(line)
    }
  }

  if (items.length < 2 || items.length > 10) return null
  if (items.some((item) => item.label.length > 64)) return null
  if (text.length > 1800 && !/ACTIVITY/i.test(text) && !/✓/.test(text)) return null
  return {
    title: title || 'Latest activity',
    lede,
    items,
    read,
  }
}
