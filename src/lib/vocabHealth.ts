import type { SupabaseClient } from '@supabase/supabase-js'
import vocabSections from '../data/vocabSections.json'
import { VOCAB_SECTION_OPTIONS } from './lessonEditor'

/**
 * Vocab tab health, counted the way the learner app does (Dubbadhu/features/VocabTab/vocabWordsSource.js):
 * each section is the bundled list (src/data/vocabSections.json, `npm run sync:vocab-sections`) matched to
 * `words` rows by Afaan Oromo text. A word shows only when a matched row has a remote audio URL,
 * so a section with 0 playable words opens empty (the app hides those sections).
 */

export type VocabWordHealth = {
  oromo: string
  english: string
  hasAudio: boolean
  hasPicture: boolean
  /** Status of the matched word bank row, or null when the word isn't in the bank at all. */
  bankStatus: string | null
}

export type VocabSectionHealth = {
  key: string
  label: string
  words: VocabWordHealth[]
  total: number
  withAudio: number
  withPicture: number
  /** No playable word: the section opens empty in the app. */
  opensEmpty: boolean
  /** Hidden from the Vocab dropdown on purpose (learner VOCAB_DROPDOWN_HIDDEN_KEYS). */
  hiddenInApp: boolean
}

type WordRow = {
  id: string
  word: string | null
  series: string | null
  status: string | null
  fast_audio_url: string | null
  slow_audio_url: string | null
  audio_ref: string | null
  illustration_url: string | null
}

/** Same as the learner app's normalizeOromoLookupKey. */
export function normalizeOromoLookupKey(s: unknown): string {
  return String(s ?? '')
    .replace(/‘|’/g, "'")
    .trim()
    .toLowerCase()
    .replace(/[?!.,'"“”¿¡]/g, '')
    .replace(/\s+/g, ' ')
}

const isRemote = (v: unknown) => /^https?:\/\//.test(String(v ?? '').trim())

function rowHasPlayableAudio(r: WordRow): boolean {
  return isRemote(r.fast_audio_url) || isRemote(r.slow_audio_url) || (isRemote(r.audio_ref) && !/^vocab-/i.test(String(r.audio_ref)))
}

const isVocabSeries = (r: WordRow) => String(r.series ?? '').trim().toLowerCase() === 'vocabulary'

function lookupKeys(oromo: string): string[] {
  const keys = [normalizeOromoLookupKey(oromo), oromo.trim().toLowerCase()]
  const bare = keys[0].replace(/^-+/, '')
  if (bare && bare !== keys[0]) keys.push(bare)
  return keys.filter(Boolean)
}

const HIDDEN_IN_APP = new Set(['CommonVerbs'])

function sectionLabel(key: string): string {
  return VOCAB_SECTION_OPTIONS.find((o) => o.value === key)?.label ?? key.replace(/([a-z])([A-Z])/g, '$1 $2')
}

/** Pure: build per-section health from the word bank rows (unit-testable). */
export function buildVocabHealth(
  sections: Record<string, { oromo: string; english: string }[]>,
  rows: WordRow[],
): VocabSectionHealth[] {
  const audioByKey = new Map<string, WordRow>()
  const anyByKey = new Map<string, WordRow>()
  for (const r of rows) {
    const word = String(r.word ?? '').trim()
    if (!word) continue
    for (const k of [normalizeOromoLookupKey(word), word.toLowerCase()]) {
      if (rowHasPlayableAudio(r)) {
        const cur = audioByKey.get(k)
        // Prefer the dedicated vocabulary row, like the app.
        if (!cur || (isVocabSeries(r) && !isVocabSeries(cur))) audioByKey.set(k, r)
      }
      const cur = anyByKey.get(k)
      if (!cur || (isVocabSeries(r) && !isVocabSeries(cur))) anyByKey.set(k, r)
    }
  }
  const find = (map: Map<string, WordRow>, oromo: string) => {
    for (const k of lookupKeys(oromo)) {
      const r = map.get(k)
      if (r) return r
    }
    return null
  }

  return Object.entries(sections).map(([key, items]) => {
    const words: VocabWordHealth[] = items.map((it) => {
      const audio = find(audioByKey, it.oromo)
      const any = find(anyByKey, it.oromo)
      return {
        oromo: it.oromo,
        english: it.english,
        hasAudio: Boolean(audio),
        hasPicture: Boolean(String(any?.illustration_url ?? audio?.illustration_url ?? '').trim()),
        bankStatus: any ? String(any.status ?? 'unknown') : null,
      }
    })
    const withAudio = words.filter((w) => w.hasAudio).length
    return {
      key,
      label: sectionLabel(key),
      words,
      total: words.length,
      withAudio,
      withPicture: words.filter((w) => w.hasPicture).length,
      opensEmpty: withAudio === 0,
      hiddenInApp: HIDDEN_IN_APP.has(key),
    }
  })
}

const SELECT = 'id, word, series, status, fast_audio_url, slow_audio_url, audio_ref, illustration_url'

async function fetchPaged(
  client: SupabaseClient,
  apply: (q: any) => any,
): Promise<{ rows: WordRow[]; error: string | null }> {
  const rows: WordRow[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await apply(client.from('words').select(SELECT)).range(from, from + 999)
    if (error) return { rows, error: error.message }
    const batch = (data ?? []) as WordRow[]
    rows.push(...batch)
    if (batch.length < 1000) break
  }
  return { rows, error: null }
}

export async function fetchVocabHealth(
  client: SupabaseClient,
): Promise<{ data: VocabSectionHealth[]; error: string | null }> {
  // Same two pools the app merges: any row with audio, plus every vocabulary-series row.
  // Plus words still in the recording queue (not approved), so a missing word shows its queue status.
  const [audio, vocab, queue] = await Promise.all([
    fetchPaged(client, (q) => q.not('translation', 'is', null).or('fast_audio_url.not.is.null,slow_audio_url.not.is.null')),
    fetchPaged(client, (q) => q.ilike('series', 'vocabulary')),
    fetchPaged(client, (q) => q.neq('status', 'approved')),
  ])
  const error = audio.error || vocab.error || queue.error
  if (error) return { data: [], error }
  const byId = new Map<string, WordRow>()
  for (const r of [...queue.rows, ...audio.rows, ...vocab.rows]) byId.set(r.id, r)
  return { data: buildVocabHealth(vocabSections as Record<string, { oromo: string; english: string }[]>, [...byId.values()]), error: null }
}
