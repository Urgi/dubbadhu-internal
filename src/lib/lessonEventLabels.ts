import type { SupabaseClient } from '@supabase/supabase-js'
import { wordsBankSeriesLabelFromSeriesId } from './voiceBankLabels'

export type LessonLabelSource = {
  id: string
  title?: string | null
  series_id?: string | null
  lesson_number?: number | null
}

/** "Series 1 · Lesson 3 · Nagaa" so admin can tell generated ids apart. */
export function formatLessonDisplayLabel(row: LessonLabelSource): string {
  const seriesId = String(row.series_id ?? '').trim()
  const series = seriesId ? wordsBankSeriesLabelFromSeriesId(seriesId) : ''
  const num =
    row.lesson_number != null && Number.isFinite(Number(row.lesson_number))
      ? `Lesson ${Number(row.lesson_number)}`
      : ''
  const title = String(row.title ?? '').trim()
  const parts = [series, num, title].filter(Boolean)
  return parts.join(' · ') || row.id
}

export function lessonIdFromProperties(
  properties: Record<string, unknown> | null | undefined,
): string | null {
  const raw = properties?.lesson_id
  if (typeof raw !== 'string') return null
  const id = raw.trim()
  return id || null
}

export function uniqueLessonIds(
  rows: { properties: Record<string, unknown> | null }[],
): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const id = lessonIdFromProperties(row.properties)
    if (id) ids.add(id)
  }
  return [...ids]
}

/** Map lessons.id → readable label. Missing rows are omitted. */
export async function fetchLessonDisplayLabels(
  client: SupabaseClient,
  lessonIds: string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(lessonIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return {}

  const { data, error } = await client
    .from('lessons')
    .select('id,title,series_id,lesson_number')
    .in('id', ids)

  if (error || !data) return {}

  const labels: Record<string, string> = {}
  for (const row of data as LessonLabelSource[]) {
    if (!row?.id) continue
    labels[row.id] = formatLessonDisplayLabel(row)
  }
  return labels
}
