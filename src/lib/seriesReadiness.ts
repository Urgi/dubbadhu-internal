import type { SupabaseClient } from '@supabase/supabase-js'
import { findVideoReviewScreensMissingUrl } from './lessonVideoReviewGate'

/**
 * Publish checklist for one series. Every check must be green before Publish is allowed.
 * Waveforms use the same prod function the publish trigger uses (series_missing_waveforms),
 * so the app and the DB agree.
 */

export type ReadinessCheckId =
  | 'hero_cover'
  | 'home_cover'
  | 'list_cover'
  | 'intro_video'
  | 'intro_video_no_translation'
  | 'review_video'
  | 'waveforms'
  | 'audio'
  | 'reply_pills'

export type ReadinessCheck = {
  id: ReadinessCheckId
  label: string
  ok: boolean
  /** Short reason when red, e.g. "3 words: Akkam, Nagaa, …". */
  detail: string
}

export type SeriesReadiness = {
  seriesId: string
  checks: ReadinessCheck[]
  ready: boolean
}

type SeriesRow = {
  id: string
  list_cover_url: string | null
  home_cover_url: string | null
  hero_cover_url: string | null
  intro_video_url: string | null
  intro_video_no_translation_url: string | null
}

type LessonRow = { id: string; title: string | null; content: unknown }

type WordRow = { id: string; word: string | null; fast_audio_url: string | null; slow_audio_url: string | null }

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

function sample(names: string[], max = 4): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown}, +${names.length - max} more` : shown
}

function screensOf(content: unknown): Array<{ type: string; content: Record<string, unknown> }> {
  if (content == null || typeof content !== 'object' || Array.isArray(content)) return []
  const screens = (content as { screens?: unknown }).screens
  if (!Array.isArray(screens)) return []
  return screens
    .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object' && !Array.isArray(s))
    .map((s) => ({
      type: String(s.type ?? '').trim(),
      content:
        s.content != null && typeof s.content === 'object' && !Array.isArray(s.content)
          ? (s.content as Record<string, unknown>)
          : {},
    }))
}

function isDiscussionOn(c: Record<string, unknown>): boolean {
  const v = c.communityDiscussionEnabled
  return v === true || v === 'true' || v === 1 || v === '1'
}

function hasPills(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x ?? '').trim().length >= 2)
  return typeof v === 'string' && v.trim().length >= 2
}

/** Every word_id in the series' lesson JSON (same pattern as series_missing_waveforms). */
export function wordIdsInLessons(lessons: LessonRow[]): string[] {
  const ids = new Set<string>()
  const re = /"word_id": ?"([0-9a-f-]{36})"/g
  for (const l of lessons) {
    const text = JSON.stringify(l.content ?? null)
    for (const m of text.matchAll(re)) ids.add(m[1])
  }
  return [...ids]
}

/** Pure: build the checklist from already-loaded rows (unit-testable). */
export function buildSeriesReadiness(
  series: SeriesRow,
  lessons: LessonRow[],
  words: WordRow[],
  missingWaveformWords: string[],
): SeriesReadiness {
  const checks: ReadinessCheck[] = []
  const urlCheck = (id: ReadinessCheckId, label: string, value: string | null) =>
    checks.push({ id, label, ok: filled(value), detail: filled(value) ? '' : 'Not set' })

  urlCheck('hero_cover', 'Hero cover', series.hero_cover_url)
  urlCheck('home_cover', 'Home cover', series.home_cover_url)
  urlCheck('list_cover', 'Speak list cover', series.list_cover_url)
  urlCheck('intro_video', 'Intro video', series.intro_video_url)
  urlCheck('intro_video_no_translation', 'Intro video (no translation)', series.intro_video_no_translation_url)

  const reviewScreens = lessons.reduce(
    (n, l) => n + screensOf(l.content).filter((s) => s.type === 'videoReview').length,
    0,
  )
  const reviewGaps = findVideoReviewScreensMissingUrl(lessons)
  checks.push({
    id: 'review_video',
    label: 'Review lesson video',
    ok: reviewScreens > 0 && reviewGaps.length === 0,
    detail:
      reviewScreens === 0
        ? 'No Review (videoReview) screen in this series'
        : reviewGaps.length
          ? `No videoUrl in ${sample(reviewGaps.map((g) => g.lessonTitle))}`
          : '',
  })

  checks.push({
    id: 'waveforms',
    label: 'Waveforms on every word',
    ok: missingWaveformWords.length === 0,
    detail: missingWaveformWords.length
      ? `${missingWaveformWords.length} word(s): ${sample(missingWaveformWords)}. Run npm run compute:word-waveforms.`
      : '',
  })

  const noAudio = words.filter((w) => !filled(w.fast_audio_url) && !filled(w.slow_audio_url))
  const foundIds = new Set(words.map((w) => w.id))
  const unknownIds = wordIdsInLessons(lessons).filter((id) => !foundIds.has(id))
  const audioGaps = [...noAudio.map((w) => w.word || w.id), ...unknownIds.map((id) => `missing word ${id.slice(0, 8)}`)]
  checks.push({
    id: 'audio',
    label: 'Audio on every item',
    ok: audioGaps.length === 0,
    detail: audioGaps.length ? `${audioGaps.length} without audio: ${sample(audioGaps)}. See the recording queue.` : '',
  })

  const pillGaps: string[] = []
  let discussionScreens = 0
  for (const l of lessons) {
    for (const s of screensOf(l.content)) {
      const isDiscussion = s.type === 'communityBoard' || ((s.type === 'CelebrateScreen' || s.type === 'celebration') && isDiscussionOn(s.content))
      if (!isDiscussion) continue
      discussionScreens += 1
      const missing = [
        hasPills(s.content.communityDiscussionCommentPills) ? null : 'comment',
        hasPills(s.content.communityDiscussionReplyPills) ? null : 'reply',
      ].filter(Boolean)
      if (missing.length) pillGaps.push(`${l.title?.trim() || l.id} (${missing.join(' + ')})`)
    }
  }
  checks.push({
    id: 'reply_pills',
    label: 'Discussion pills',
    ok: pillGaps.length === 0,
    detail:
      discussionScreens === 0
        ? ''
        : pillGaps.length
          ? `Missing in ${sample(pillGaps, 3)}. Add them in the lesson editor.`
          : '',
  })

  return { seriesId: series.id, checks, ready: checks.every((c) => c.ok) }
}

export async function fetchSeriesReadiness(
  client: SupabaseClient,
  seriesId: string,
): Promise<{ data: SeriesReadiness | null; error: string | null }> {
  const [seriesRes, lessonsRes, waveRes] = await Promise.all([
    client
      .from('lesson_series')
      .select('id, list_cover_url, home_cover_url, hero_cover_url, intro_video_url, intro_video_no_translation_url')
      .eq('id', seriesId)
      .maybeSingle(),
    client.from('lessons').select('id, title, content').eq('series_id', seriesId),
    client.rpc('series_missing_waveforms', { p_series_id: seriesId }),
  ])
  if (seriesRes.error) return { data: null, error: seriesRes.error.message }
  if (!seriesRes.data) return { data: null, error: `No lesson_series row for ${seriesId}` }
  if (lessonsRes.error) return { data: null, error: lessonsRes.error.message }
  if (waveRes.error) return { data: null, error: `Waveform check: ${waveRes.error.message}` }

  const lessons = (lessonsRes.data ?? []) as LessonRow[]
  const ids = wordIdsInLessons(lessons)
  const words: WordRow[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await client
      .from('words')
      .select('id, word, fast_audio_url, slow_audio_url')
      .in('id', ids.slice(i, i + 150))
    if (error) return { data: null, error: error.message }
    words.push(...((data ?? []) as WordRow[]))
  }
  const missingWave = ((waveRes.data ?? []) as Array<{ word: string | null }>).map((r) => String(r.word ?? '?'))
  return {
    data: buildSeriesReadiness(seriesRes.data as SeriesRow, lessons, words, missingWave),
    error: null,
  }
}
