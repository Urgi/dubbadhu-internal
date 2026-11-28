/**
 * Helpers, field components and styles shared by LessonScreenEditModal and the per-screen-type
 * editors in ./screen-editors (split out of LessonScreenEditModal.tsx, behaviour unchanged).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { EXPOSURE_PHRASE_HARD_MAX } from '../../lib/learnerTextLimits'
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import * as VideoThumbnails from 'expo-video-thumbnails'
import { AdminTextInput } from '../AdminTextInput'
import type { LessonScreen } from '../../lib/lessonEditor'
import {
  SCREEN_TYPE_OPTIONS,
  VOCAB_SECTION_OPTIONS,
  celebrateAfaanDedupeKey,
  normalizeQuizOptionRowForEditor,
} from '../../lib/lessonEditor'
import { WORD_DISCRIMINATION_SCENE_PREVIEW_ASPECT } from '../../lib/wordDiscriminationSceneSpec'
import {
  generateLessonImageScreenDraft,
  generateWordDiscriminationImageDraft,
  LESSON_IMAGE_SCREEN_PREVIEW_ASPECT,
  uploadLessonImageScreenDraft,
  uploadWordDiscriminationImageDraft,
  wordDiscriminationImageStorageBaseName,
  type WordDiscriminationImageDraft,
} from '../../lib/geminiWordDiscriminationImage'
import { getExpoPublicGeminiKey } from '../../lib/expoPublicEnv'
import supabase from '../../lib/supabase'
import type { HarvestedWord } from '../../lib/seedWordsFromLessons'
import {
  buildWordBankLookupLabels,
  fetchWordBankRowForLessonWord,
  harvestWordsFromLessonScreens,
  lookupWordBankRowWithSeriesLabels,
} from '../../lib/seedWordsFromLessons'
import { voiceBankLanguageSqlValues } from '../../lib/voiceBankLabels'

export const STRUCTURED_SCREEN_TYPES_FOR_HEADER_SAVE = new Set([
  'intro',
  'concept',
  'dialogue',
  'match',
  'quiz',
  'textQuiz',
  'speakingPractice',
  'audioExposure',
  'CelebrateScreen',
  'patternPractice',
  'discriminationDrill',
  'word-breakdown',
  'videoReview',
  'imageScreen',
  'repetition',
  'repetitionPractice',
  'sentenceBuilder',
  'communityBoard',
])

export const COMMUNITY_PROMPT_AUTHORING_NOTES =
  'Name the target word spelled exactly as learners must type it. Moderation (and the fallback if AI is down) looks for that spelling as a whole word.\n\n' +
  'Do this:\n' +
  '• Quote it: Say “akkam” to other learners in Afaan Oromo.\n' +
  '• Or start with Say + the word: Say Akkam to the class.\n\n' +
  'Typos like Akaam or akam do not count as the lesson word.\n\n' +
  'If AI moderation is down, learners are told to include that word spelled exactly like the prompt.\n\n' +
  'Celebration only: “Allowed English / non-Oromo” is a note for the AI. Learners never see it. Use it for names, “hello”, etc.'

export function showCommunityPromptAuthoringNotes() {
  Alert.alert('How to write the community prompt', COMMUNITY_PROMPT_AUTHORING_NOTES)
}

/** Public storage bucket for Word discrimination quiz question images (Supabase dashboard). */
export const WORD_DISCRIMINATION_IMAGES_BUCKET = 'word-comparison-images'

/** Public bucket for Dubbadhu lesson / series videos (same as learner app SeriesIntro URLs). */
export const VIDEOS_DUBBADHU_BUCKET = 'Videos-Dubbadhu'

export type Props = {
  visible: boolean
  screen: LessonScreen | null
  /** Same draft as the lesson editor; used to derive Celebrate `learned` from Audio exposure words. */
  lessonScreens?: LessonScreen[]
  /** Index of this screen in `lessonScreens` (for Afaan lookup: include unsaved edits on this screen in harvest). */
  lessonScreenIndex?: number | null
  /** Optional: series id for word-bank checks from parent (Audio exposure, etc.). */
  lessonSeries?: string | null
  /** Current lesson row id — used when filling Match pairs from the whole series. */
  lessonId?: string | null
  /** Optional: `lesson.content.series` string (e.g. "Mastering Greetings") for `words.series` matching. */
  lessonContentSeries?: string | null
  /** Resolved series video used by dialogue clips (no-translation preferred, translated fallback). */
  seriesNoTranslationVideoUrl?: string | null
  wordBankLanguage?: string
  /** Professors: false — hide raw JSON and JSON-only escape hatches. */
  allowJsonEditing?: boolean
  /** Professors: false — no storage picker / URL fields for the review step (admin adds later). */
  allowVideoReviewMediaFields?: boolean
  /** Preview-only: same structured UI as admins, no edits or save (e.g. professor viewing admin_draft). */
  readOnly?: boolean
  onClose: () => void
  onApply: (next: LessonScreen) => void
}

export const LessonEditorReadOnlyContext = createContext(false)

export function useLessonEditorReadOnly() {
  return useContext(LessonEditorReadOnlyContext)
}

/** Normalize pattern practice / legacy option entries to display text (no audio refs persisted). */
export function patternOptionString(x: unknown): string {
  if (typeof x === 'string') return x.trim()
  if (x != null && typeof x === 'object' && !Array.isArray(x)) {
    const t = (x as Record<string, unknown>).text
    if (typeof t === 'string') return t.trim()
  }
  return String(x ?? '').trim()
}

/** Row from `public.words` (`word` + `translation` + audio URLs). Lesson-only harvest rows reuse the same shape. */
export type WordBankRow = {
  id: string
  word?: string | null
  translation?: string | null
  slow_audio_url?: string | null
  fast_audio_url?: string | null
  /** On lesson-token picks: exposure `draftTokenId` so video review / speaking can share the draft link. */
  draftTokenId?: string | null
}

/** Columns returned for word-bank search / pick lists (matches `public.words`). */
export const WORD_BANK_LIST_COLUMNS = 'id,word,translation,slow_audio_url,fast_audio_url'

export function rowAfaanText(r: WordBankRow): string {
  return String(r.word ?? '').trim()
}

export function rowAfaanTextForBankPick(r: WordBankRow): string {
  return String(r.word ?? '').trim()
}

export function rowTranslationText(r: WordBankRow): string {
  return String(r.translation ?? '').trim()
}

/** Shorter Afaan labels first (then alphabetical) so tight substring matches surface before long phrases. */
export function sortWordBankRowsShortestAfaanFirst(rows: WordBankRow[]): WordBankRow[] {
  return [...rows].sort((a, b) => {
    const sa = rowAfaanText(a)
    const sb = rowAfaanText(b)
    const la = sa.length
    const lb = sb.length
    if (la !== lb) return la - lb
    const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' })
    if (c !== 0) return c
    return a.id.localeCompare(b.id)
  })
}

/** Dubbadhu quiz `audioRef`: prefer fast recording URL, then slow, when present on `words`. */
export function audioRefFromWordRow(row: WordBankRow): string | undefined {
  const fast = row.fast_audio_url?.trim()
  const slow = row.slow_audio_url?.trim()
  return fast || slow || undefined
}

/**
 * Word bank → learner exposure fields (`AudioExposureScreen.resolveExposureAudioUrls`).
 * Writes `fastAudioRef` / `slowAudioRef` only; clears legacy `audioRef`.
 */
export function applyWordBankUrlsToExposureWord(item: Record<string, unknown>, row: WordBankRow) {
  const fast = row.fast_audio_url?.trim()
  const slow = row.slow_audio_url?.trim()
  delete item.fastAudioRef
  delete item.slowAudioRef
  delete item.audioRef
  if (fast) {
    item.fastAudioRef = fast
  }
  if (slow) {
    item.slowAudioRef = slow
  }
}

export type QuizOptionDraft = {
  text: string
  english: string
  word_id?: string
  audioRef?: string
}

export function serializeQuizOption(x: QuizOptionDraft): Record<string, unknown> {
  const o: Record<string, unknown> = { text: x.text, english: x.english }
  if (x.word_id) o.word_id = x.word_id
  if (x.audioRef?.trim()) o.audioRef = x.audioRef.trim()
  return o
}

export function ensureQuizQuestionsArray(cur: Record<string, unknown>): Record<string, unknown>[] {
  let questions = (cur.questions as Record<string, unknown>[]) ?? []
  if (!Array.isArray(questions) || questions.length === 0) {
    if (typeof cur.question === 'string') {
      questions = [
        {
          question: cur.question,
          options: Array.isArray(cur.options) ? cur.options : ['', ''],
          correctAnswer: typeof cur.correctAnswer === 'number' ? cur.correctAnswer : 0,
        },
      ]
    } else {
      questions = [{ question: '', options: ['', ''], correctAnswer: 0 }]
    }
  }
  return questions
}

export function quizOptionsDraftFromQ0(q0: Record<string, unknown>): QuizOptionDraft[] {
  const optionsRaw = Array.isArray(q0.options) ? (q0.options as unknown[]) : []
  return optionsRaw
    .map((o) => {
      if (typeof o === 'string') return { text: String(o).trim(), english: '' }
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return normalizeQuizOptionRowForEditor(o as Record<string, unknown>)
      }
      return { text: String(o ?? ''), english: '' }
    })
    .filter((x) => x.text.trim() !== '')
}

export function quizContentWithAudioOptionsFlag(content: Record<string, unknown>): Record<string, unknown> {
  const qs = content.questions
  if (!Array.isArray(qs) || qs.length === 0) return { ...content, audioOptions: false }
  const hasAudio = qs.some((q) => {
    if (q == null || typeof q !== 'object' || Array.isArray(q)) return false
    const opts = (q as Record<string, unknown>).options
    if (!Array.isArray(opts)) return false
    return opts.some((item) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return false
      const ar = (item as Record<string, unknown>).audioRef
      return typeof ar === 'string' && ar.trim().length > 0
    })
  })
  return { ...content, audioOptions: hasAudio }
}

export function patchQuizQuestionInContent(
  cur: Record<string, unknown>,
  qIndex: number,
  patcher: (q: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const qs = ensureQuizQuestionsArray(cur)
  if (qIndex < 0 || qIndex >= qs.length) return cur
  const row = { ...(qs[qIndex] as Record<string, unknown>) }
  const updated = patcher(row)
  const nextQs = qs.map((x, i) => (i === qIndex ? updated : x))
  return quizContentWithAudioOptionsFlag({ ...cur, questions: nextQs })
}

/** Text quiz rows are free-typed, so keep blank options while editing (trim happens on save). */
export function ensureTextQuizQuestionsArray(cur: Record<string, unknown>): Record<string, unknown>[] {
  const questions = cur.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    return [{ question: '', options: ['', ''], correctAnswer: 0 }]
  }
  return questions.map((q) =>
    q != null && typeof q === 'object' && !Array.isArray(q) ? (q as Record<string, unknown>) : {},
  )
}

export function textQuizOptionsFromQuestion(q: Record<string, unknown>): string[] {
  const raw = Array.isArray(q.options) ? (q.options as unknown[]) : []
  const opts = raw.map((o) => String(o ?? ''))
  return opts.length >= 2 ? opts : [...opts, ...Array(2 - opts.length).fill('')]
}

export function patchTextQuizQuestionInContent(
  cur: Record<string, unknown>,
  qIndex: number,
  patcher: (q: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const qs = ensureTextQuizQuestionsArray(cur)
  if (qIndex < 0 || qIndex >= qs.length) return cur
  const nextQs = qs.map((x, i) => (i === qIndex ? patcher({ ...x }) : x))
  return { ...cur, questions: nextQs }
}

export function glossFromWordRow(row: { translation?: string | null }): string {
  return String(row.translation ?? '').trim()
}

export type TranslationConflictChoice = 'lesson' | 'database' | 'cancel'

export type TranslationConflictPrompt = (args: {
  afaan: string
  lessonTranslation: string
  databaseTranslation: string
  conflictNumber: number
  totalConflicts: number
}) => Promise<TranslationConflictChoice>

export type TranslationConflictPayload = {
  key: number
  afaan: string
  lessonTranslation: string
  databaseTranslation: string
  conflictNumber: number
  totalConflicts: number
}

/**
 * Compares Audio exposure tokens to this series’ `words` rows only. Does not write to the database;
 * conflicts are resolved in lesson JSON. Draft inserts/updates run on approval; live-series lesson
 * saves sync linked definitions after the confirmation step.
 */
export async function resolveAudioExposureWordsAgainstBank(
  words: Record<string, unknown>[],
  lessonSeriesId: string | null | undefined,
  lessonContentSeries: string | null | undefined,
  promptConflict: TranslationConflictPrompt,
): Promise<Record<string, unknown>[]> {
  const labels = await buildWordBankLookupLabels(lessonSeriesId, lessonContentSeries)
  if (labels.length === 0) {
    return words.map((w) => ({ ...w }))
  }

  const out = words.map((w) => ({ ...w }))

  type Collected = {
    wordIndex: number
    afaan: string
    lessonTranslation: string
    databaseTranslation: string
  }
  const conflicts: Collected[] = []
  for (let i = 0; i < out.length; i++) {
    const item = out[i] as Record<string, unknown>
    const o = String(item.word ?? '').trim()
    const e = String(item.translation ?? item.english ?? '').trim()
    if (!o || !e) throw new Error('Audio exposure words require both Afaan Oromo text and translation.')
    if (o.length > EXPOSURE_PHRASE_HARD_MAX) {
      throw new Error(
        `Word ${i + 1} is ${o.length} characters. The learner screen fits ${EXPOSURE_PHRASE_HARD_MAX}. Split it into two words.`,
      )
    }

    const row = await lookupWordBankRowWithSeriesLabels(labels, o)
    if (!row) continue

    const dbGloss = glossFromWordRow(row)
    if (dbGloss === e) continue

    conflicts.push({
      wordIndex: i,
      afaan: o,
      lessonTranslation: e,
      databaseTranslation: dbGloss,
    })
  }

  for (let c = 0; c < conflicts.length; c++) {
    const { wordIndex, afaan, lessonTranslation, databaseTranslation } = conflicts[c]
    const choice = await promptConflict({
      afaan,
      lessonTranslation,
      databaseTranslation,
      conflictNumber: c + 1,
      totalConflicts: conflicts.length,
    })
    if (choice === 'cancel') throw new Error('Save cancelled.')

    if (choice === 'database') {
      const item = out[wordIndex] as Record<string, unknown>
      out[wordIndex] = { ...item, translation: databaseTranslation, english: undefined }
    }
  }
  return out
}

export function wordLabel(row: WordBankRow): string {
  const a = rowAfaanTextForBankPick(row)
  const b = rowTranslationText(row)
  if (a && b) return `${a} — ${b}`
  return a || b || row.id
}

export function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

/** Gloss from `public.words` for tokens that only store `word_id` (admin editor + bank compare). */
export async function fetchWordTranslationsByIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [
    ...new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => isUuidLike(id))),
  ]
  if (unique.length === 0) return map
  const { data, error } = await supabase.from('words').select('id,translation').in('id', unique)
  if (error || !Array.isArray(data)) return map
  for (const row of data as { id: string; translation?: string | null }[]) {
    const gloss = String(row.translation ?? '').trim()
    if (gloss) map.set(String(row.id).trim().toLowerCase(), gloss)
  }
  return map
}

export function screenTypeTitle(type: string): string {
  return SCREEN_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

export async function fetchWordBankRows(query: string): Promise<{ data: WordBankRow[] | null; error: Error | null }> {
  const trimmed = query.trim()
  const isUuid = isUuidLike(trimmed)
  let q = supabase.from('words').select(WORD_BANK_LIST_COLUMNS).limit(25)
  if (isUuid) q = q.eq('id', trimmed)
  else q = q.or(`word.ilike.%${trimmed}%,translation.ilike.%${trimmed}%`)
  const res = await q
  if (res.error) return { data: null, error: new Error(res.error.message) }
  const filtered = ((res.data as WordBankRow[] | null) ?? []).filter((r) => typeof r?.id === 'string')
  return { data: sortWordBankRowsShortestAfaanFirst(filtered), error: null }
}

export const LESSON_PICK_ID_PREFIX = 'lesson-token:'

export type LessonHarvestPickerWord = HarvestedWord & { draftTokenId?: string }

export function mergeDbAndLessonHarvestForPicker(
  db: WordBankRow[],
  harvested: LessonHarvestPickerWord[],
  query: string,
): WordBankRow[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return db
  const keys = new Set(db.map((r) => celebrateAfaanDedupeKey(rowAfaanText(r))))
  const extra: WordBankRow[] = []
  for (const h of harvested) {
    const w = h.word.trim()
    if (!w || !w.toLowerCase().includes(q)) continue
    const k = celebrateAfaanDedupeKey(w)
    if (keys.has(k)) continue
    keys.add(k)
    const dt = String(h.draftTokenId ?? '').trim()
    extra.push({
      id: `${LESSON_PICK_ID_PREFIX}${k}`,
      word: w,
      translation: h.translation,
      ...(dt ? { draftTokenId: dt } : {}),
    })
  }
  return sortWordBankRowsShortestAfaanFirst([...db, ...extra])
}

/** Audio exposure tokens in the draft lesson (for Afaan lookup: same shape as broad harvest merge). */
export function harvestAudioExposureWordsForPicker(screens: LessonScreen[]): LessonHarvestPickerWord[] {
  const out: LessonHarvestPickerWord[] = []
  const seen = new Set<string>()
  for (const s of screens) {
    if (s.type !== 'audioExposure') continue
    const words = (s.content as Record<string, unknown>).words
    if (!Array.isArray(words)) continue
    for (const w of words) {
      if (w == null || typeof w !== 'object' || Array.isArray(w)) continue
      const rec = w as Record<string, unknown>
      const afaan = String(rec.word ?? rec.oromo ?? rec.text ?? '').trim()
      if (!afaan) continue
      const key = celebrateAfaanDedupeKey(afaan)
      if (seen.has(key)) continue
      seen.add(key)
      const english = String(rec.translation ?? rec.english ?? '').trim()
      const dt = String(rec.draftTokenId ?? '').trim()
      out.push({
        word: afaan,
        translation: english || null,
        ...(dt ? { draftTokenId: dt } : {}),
      })
    }
  }
  return out
}

export function isRealWordBankRowId(row: WordBankRow): boolean {
  return !row.id.startsWith(LESSON_PICK_ID_PREFIX)
}

/** Word bank rows restricted to `words.series` labels (+ language when column exists). */
export async function fetchWordBankRowsForSeries(
  query: string,
  seriesLabels: string[],
): Promise<{ data: WordBankRow[] | null; error: Error | null }> {
  if (!seriesLabels.length) return { data: [], error: null }
  const trimmed = query.trim()
  const isUuid = isUuidLike(trimmed)
  const langVals = voiceBankLanguageSqlValues()

  const run = async (useLanguage: boolean): Promise<{ data: WordBankRow[] | null; error: Error | null }> => {
    let q = supabase.from('words').select(WORD_BANK_LIST_COLUMNS).in('series', seriesLabels).limit(25)
    if (useLanguage) q = q.in('language', langVals)
    if (isUuid) q = q.eq('id', trimmed)
    else q = q.or(`word.ilike.%${trimmed}%,translation.ilike.%${trimmed}%`)
    const res = await q
    if (res.error) return { data: null, error: new Error(res.error.message) }
    const filtered = ((res.data as WordBankRow[] | null) ?? []).filter((r) => typeof r?.id === 'string')
    return { data: sortWordBankRowsShortestAfaanFirst(filtered), error: null }
  }

  let lastMsg = ''
  for (const useLang of [true, false]) {
    const { data, error } = await run(useLang)
    if (!error && data) return { data, error: null }
    if (error) {
      lastMsg = error.message
      if (
        useLang &&
        /column .* does not exist|Could not find|does not exist|PGRST100/i.test(error.message)
      ) {
        continue
      }
      return { data: null, error }
    }
  }
  return { data: null, error: new Error(lastMsg || 'words search failed') }
}

export function LessonAndSeriesWordPicker({
  label,
  seriesLabels,
  lessonHarvested,
  onPick,
  hint,
}: {
  /** Omit to show only search + results (e.g. word discrimination already has “Word N” above). */
  label?: string
  seriesLabels: string[]
  lessonHarvested: HarvestedWord[]
  onPick: (row: WordBankRow) => void
  hint?: string
}) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<WordBankRow[]>([])
  const [err, setErr] = useState('')
  const lastReq = useRef(0)

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setRows([])
      setErr('')
      return
    }
    const reqId = ++lastReq.current
    setLoading(true)
    setErr('')
    const t = setTimeout(() => {
      void (async () => {
        const { data, error } = await fetchWordBankRowsForSeries(query, seriesLabels)
        if (reqId !== lastReq.current) return
        setLoading(false)
        if (error || data == null) {
          setErr(error?.message ?? 'Search failed')
          setRows([])
          return
        }
        setErr('')
        setRows(mergeDbAndLessonHarvestForPicker(data, lessonHarvested, query))
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [q, seriesLabels, lessonHarvested])

  return (
    <View style={styles.wordPicker}>
      {label?.trim() ? <Text style={styles.label}>{label}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <AdminTextInput
        style={styles.input}
        value={q}
        onChangeText={setQ}
        placeholder="Search (2+ letters) — series word bank + words from this lesson"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {loading ? <Text style={styles.hint}>Searching…</Text> : null}
      {err ? <Text style={styles.jsonErr}>{err}</Text> : null}
      {rows.length ? (
        <View style={styles.wordResults}>
          {rows.map((r) => (
            <Pressable
              key={r.id}
              style={styles.wordResultRow}
              onPress={() => {
                onPick(r)
                setQ('')
                setRows([])
              }}
            >
              <View style={styles.wordResultTextCol}>
                <Text style={styles.wordResultTextTop}>{rowAfaanTextForBankPick(r) || r.id}</Text>
                {rowTranslationText(r) ? (
                  <Text style={styles.wordResultTextSub}>{rowTranslationText(r)}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export async function isWordAllowedForDiscrimination(
  word: string,
  lessonSeries: string | null | undefined,
  lessonContentSeries: string | null | undefined,
  harvested: HarvestedWord[],
): Promise<boolean> {
  const w = word.trim()
  if (!w) return false
  const k = w.toLowerCase()
  if (harvested.some((h) => h.word.trim().toLowerCase() === k)) return true
  const row = await fetchWordBankRowForLessonWord(lessonSeries, lessonContentSeries, w)
  return row != null
}

/** Canonical English/gloss for saved JSON: word bank row wins, else lesson harvest. */
export async function resolveDiscriminationDefinition(
  word: string,
  lessonSeries: string | null | undefined,
  lessonContentSeries: string | null | undefined,
  harvested: HarvestedWord[],
): Promise<string> {
  const w = word.trim()
  if (!w) return ''
  const row = await fetchWordBankRowForLessonWord(lessonSeries, lessonContentSeries, w)
  const bank = (row?.translation ?? '').trim()
  if (bank) return bank
  const k = w.toLowerCase()
  const h = harvested.find((x) => x.word.trim().toLowerCase() === k)
  return (h?.translation ?? '').trim()
}

export function SceneCorrectWordPicker({
  wordLabels,
  valueIndex,
  onSelect,
}: {
  wordLabels: string[]
  valueIndex: number
  onSelect: (i: number) => void
}) {
  const [open, setOpen] = useState(false)
  const max = wordLabels.length - 1
  const safe = max < 0 ? 0 : Math.max(0, Math.min(max, Math.floor(valueIndex)))
  const currentLabel = wordLabels[safe] ?? '—'

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>Word</Text>
      {wordLabels.length < 2 ? (
        <Text style={styles.hint}>Add at least two words above first.</Text>
      ) : (
        <>
          <Text style={styles.hint}>Pick the correct word for this question, then add the image below.</Text>
          <Pressable style={styles.quizCorrectBtn} onPress={() => setOpen(true)}>
            <Text style={styles.quizCorrectBtnLabel}>Tap to choose</Text>
            <Text style={styles.quizCorrectBtnValue}>{currentLabel}</Text>
          </Pressable>
          <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
            <Pressable style={styles.quizCorrectOverlay} onPress={() => setOpen(false)}>
              <Pressable style={styles.quizCorrectSheet} onPress={() => {}}>
                <Text style={styles.personTitle}>Which word is correct?</Text>
                {wordLabels.map((lab, idx) => (
                  <Pressable
                    key={`cw-${idx}`}
                    style={styles.quizCorrectChoice}
                    onPress={() => {
                      onSelect(idx)
                      setOpen(false)
                    }}
                  >
                    <Text style={styles.quizCorrectChoiceText}>
                      {idx === safe ? '✓ ' : ''}
                      {lab}
                    </Text>
                  </Pressable>
                ))}
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </View>
  )
}

/** True for real files from storage.list (has object id, or name looks like an image file). */
export function isStorageObjectFile(f: { name: string; id?: string | null }): boolean {
  const name = f.name
  if (!name || name.endsWith('/')) return false
  if (f.id != null && String(f.id).length > 0) return true
  return /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(name)
}

export function isVideoStorageObjectFile(f: { name: string; id?: string | null }): boolean {
  const name = f.name
  if (!name || name.endsWith('/')) return false
  if (f.id != null && String(f.id).length > 0) return true
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)
}

export function VideoReviewDubbadhuVideoField({
  videoUrl,
  setContent,
  readOnly = false,
}: {
  videoUrl: string
  setContent: (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => void
  readOnly?: boolean
}) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [bucketFiles, setBucketFiles] = useState<string[]>([])
  const [filterQ, setFilterQ] = useState('')
  const [listErr, setListErr] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [rawListCount, setRawListCount] = useState(0)

  const loadBucket = useCallback(async () => {
    setListLoading(true)
    setListErr('')
    setRawListCount(0)
    const bucket = VIDEOS_DUBBADHU_BUCKET
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: 1000 })
    if (error) {
      setListLoading(false)
      setListErr(error.message)
      setBucketFiles([])
      return
    }
    const dataRows = data ?? []
    setRawListCount(dataRows.length)

    const fileRows = dataRows.map((f) => ({
      name: String(f.name ?? '').trim(),
      id: (f as { id?: string | null }).id,
    }))

    let names = fileRows.filter(isVideoStorageObjectFile).map((f) => f.name)

    if (names.length === 0 && dataRows.length > 0) {
      const folderPrefixes = fileRows
        .filter((f) => f.name && (f.id == null || f.id === '') && !f.name.includes('.'))
        .map((f) => f.name)
      for (const prefix of folderPrefixes.slice(0, 12)) {
        const nested = await supabase.storage.from(bucket).list(prefix, { limit: 500 })
        if (nested.error) continue
        const nestedRows = (nested.data ?? []).map((f) => ({
          name: String(f.name ?? '').trim(),
          id: (f as { id?: string | null }).id,
        }))
        for (const row of nestedRows.filter(isVideoStorageObjectFile)) {
          names.push(`${prefix}/${row.name}`)
        }
      }
      names = [...new Set(names)].sort((a, b) => a.localeCompare(b))
    } else {
      names = names.sort((a, b) => a.localeCompare(b))
    }

    setBucketFiles(names)
    setListLoading(false)
  }, [])

  useEffect(() => {
    if (browseOpen) {
      setFilterQ('')
      void loadBucket()
    }
  }, [browseOpen, loadBucket])

  const filteredFiles = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    if (!q) return bucketFiles
    return bucketFiles.filter((n) => n.toLowerCase().includes(q))
  }, [bucketFiles, filterQ])

  const v = String(videoUrl ?? '').trim()
  let statusLine = 'No video selected'
  if (v) {
    try {
      const tail = v.split('/').pop() ?? v
      statusLine = `Selected: ${decodeURIComponent(tail.split('?')[0] ?? tail)}`
    } catch {
      statusLine = 'Video URL set'
    }
  }

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>Video (Videos-Dubbadhu bucket)</Text>
      <Text style={[styles.hint, !v && styles.imagePickStatusEmpty]}>{statusLine}</Text>
      {readOnly ? null : (
        <>
          <Pressable style={styles.quizCorrectBtn} onPress={() => setBrowseOpen(true)}>
            <Text style={styles.quizCorrectBtnLabel}>Browse bucket</Text>
          </Pressable>
          {v ? (
            <Pressable style={styles.removeBtn} onPress={() => setContent((cur) => ({ ...cur, videoUrl: '' }))}>
              <Text style={styles.removeBtnText}>Clear video</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <Modal visible={browseOpen} transparent animationType="fade" onRequestClose={() => setBrowseOpen(false)}>
        <Pressable style={styles.quizCorrectOverlay} onPress={() => setBrowseOpen(false)}>
          <Pressable style={[styles.quizCorrectSheet, { maxHeight: 520 }]} onPress={() => {}}>
            <Text style={styles.personTitle}>Videos in {VIDEOS_DUBBADHU_BUCKET}</Text>
            <AdminTextInput
              style={styles.input}
              value={filterQ}
              onChangeText={setFilterQ}
              placeholder="Filter by file name…"
              placeholderTextColor="#52525b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {listLoading ? <Text style={styles.hint}>Loading…</Text> : null}
            {listErr ? <Text style={styles.jsonErr}>{listErr}</Text> : null}
            {!listLoading && !listErr && bucketFiles.length === 0 && rawListCount === 0 ? (
              <Text style={styles.hint}>
                Storage returned no files (RLS often hides objects from list). In Supabase → SQL, add a SELECT policy on
                storage.objects for this bucket (see sql/storage_videos_dubbadhu_anon_list.sql).
              </Text>
            ) : null}
            {!listLoading && !listErr && bucketFiles.length > 0 && filteredFiles.length === 0 ? (
              <Text style={styles.hint}>No file name matches your filter.</Text>
            ) : null}
            <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
              {filteredFiles.map((name) => (
                <Pressable
                  key={name}
                  style={styles.quizCorrectChoice}
                  onPress={() => {
                    const { data } = supabase.storage.from(VIDEOS_DUBBADHU_BUCKET).getPublicUrl(name)
                    const url = data.publicUrl
                    if (url) {
                      setContent((cur) => ({ ...cur, videoUrl: url }))
                    }
                    setBrowseOpen(false)
                  }}
                >
                  <Text style={styles.quizCorrectChoiceText}>{name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

export function DialogueVideoTimingReference({
  videoUrl,
  fromSecond,
  toSecond,
}: {
  videoUrl: string
  fromSecond: unknown
  toSecond: unknown
}) {
  const uri = String(videoUrl ?? '').trim()
  const [fromThumb, setFromThumb] = useState('')
  const [toThumb, setToThumb] = useState('')
  const [thumbBusy, setThumbBusy] = useState(false)

  const from = Number(fromSecond)
  const to = Number(toSecond)
  const fromSec = Number.isFinite(from) && from >= 0 ? from : 0
  const toSec = Number.isFinite(to) && to >= 0 ? to : fromSec

  useEffect(() => {
    if (!uri) {
      setFromThumb('')
      setToThumb('')
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        setThumbBusy(true)
        setFromThumb('')
        setToThumb('')
        try {
          const [start, end] = await Promise.allSettled([
            VideoThumbnails.getThumbnailAsync(uri, {
              time: Math.round(fromSec * 1000),
              quality: 0.72,
            }),
            VideoThumbnails.getThumbnailAsync(uri, {
              time: Math.round(toSec * 1000),
              quality: 0.72,
            }),
          ])
          if (!cancelled) {
            setFromThumb(start.status === 'fulfilled' ? start.value.uri : '')
            setToThumb(end.status === 'fulfilled' ? end.value.uri : '')
          }
        } catch {
          if (!cancelled) {
            setFromThumb('')
            setToThumb('')
          }
        } finally {
          if (!cancelled) setThumbBusy(false)
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [uri, fromSec, toSec])

  if (!uri) {
    return (
      <Text style={styles.hint}>
        No series video is available yet. Add one on the series config to preview dialogue timing.
      </Text>
    )
  }

  return (
    <View style={styles.dialogueVideoReference}>
      <View style={styles.dialogueVideoHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Series video timing reference</Text>
          <Text style={styles.hint}>Open the video to scrub, then use the start/end stills to verify your seconds.</Text>
        </View>
        <Pressable
          style={styles.dialogueOpenVideoBtn}
          onPress={() => {
            void Linking.openURL(uri).catch(() => {
              Alert.alert('Could not open video', 'Check the series video URL and try again.')
            })
          }}
        >
          <Text style={styles.dialogueOpenVideoText}>Open video</Text>
        </Pressable>
      </View>
      <View style={styles.dialogueThumbRow}>
        {[
          { label: `From ${fromSec.toFixed(2)}s`, uri: fromThumb },
          { label: `To ${toSec.toFixed(2)}s`, uri: toThumb },
        ].map((item) => (
          <View key={item.label} style={styles.dialogueThumbCell}>
            <View style={styles.dialogueThumbBox}>
              {item.uri ? <Image source={{ uri: item.uri }} style={styles.dialogueThumb} resizeMode="contain" /> : null}
              {thumbBusy && !item.uri ? <ActivityIndicator color="#d4af37" /> : null}
            </View>
            <Text style={styles.dialogueThumbLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function CelebrateVocabSectionPicker({
  value,
  label,
  onChange,
}: {
  value: string
  label: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <View style={{ marginBottom: 12 }}>
      <Pressable style={styles.quizCorrectBtn} onPress={() => setOpen(true)}>
        <Text style={styles.quizCorrectBtnLabel}>Vocab section</Text>
        <Text style={styles.quizCorrectBtnValue}>{label}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.quizCorrectOverlay} onPress={() => setOpen(false)}>
          <Pressable style={[styles.quizCorrectSheet, { maxHeight: 480 }]} onPress={() => {}}>
            <Text style={styles.personTitle}>Link Vocab section</Text>
            <Text style={styles.hint}>None → learner button says Language Vocab (all vocabulary).</Text>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              <Pressable
                style={[styles.quizCorrectChoice, !value && styles.quizCorrectChoiceOn]}
                onPress={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                <Text style={styles.quizCorrectChoiceText}>None (Language Vocab)</Text>
              </Pressable>
              {VOCAB_SECTION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[styles.quizCorrectChoice, value === opt.value && styles.quizCorrectChoiceOn]}
                  onPress={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                >
                  <Text style={styles.quizCorrectChoiceText}>{opt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={[styles.removeBtn, { marginTop: 8 }]} onPress={() => setOpen(false)}>
              <Text style={styles.removeBtnText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

export function WordDiscriminationSceneImageField({
  sceneIndex,
  image,
  imageRequestDescription,
  imageContext,
  setContent,
}: {
  sceneIndex: number
  image: string
  imageRequestDescription: string
  /** Optional 1–2 sentences: why this bucket image fits (team notes; not shown in learner UI). */
  imageContext: string
  setContent: (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => void
}) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseStep, setBrowseStep] = useState<'list' | 'preview'>('list')
  const [browsePreviewName, setBrowsePreviewName] = useState('')
  const [browsePreviewUrl, setBrowsePreviewUrl] = useState('')
  const [browseContextDraft, setBrowseContextDraft] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestDraft, setRequestDraft] = useState('')
  const [bucketFiles, setBucketFiles] = useState<string[]>([])
  const [filterQ, setFilterQ] = useState('')
  const [listErr, setListErr] = useState('')
  const [listLoading, setListLoading] = useState(false)
  const [rawListCount, setRawListCount] = useState(0)
  const [geminiBusy, setGeminiBusy] = useState(false)
  const [geminiDraft, setGeminiDraft] = useState<WordDiscriminationImageDraft | null>(null)
  const [uploadNaming, setUploadNaming] = useState(false)
  const [uploadFileName, setUploadFileName] = useState('')

  const applyScenePatch = useCallback(
    (patch: Record<string, unknown>) => {
      setContent((cur) => {
        const arr = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
        const next = arr.map((x, j) => (j === sceneIndex ? { ...x, ...patch } : x))
        return { ...cur, scenes: next }
      })
    },
    [sceneIndex, setContent],
  )

  const loadBucket = useCallback(async () => {
    setListLoading(true)
    setListErr('')
    setRawListCount(0)
    const bucket = WORD_DISCRIMINATION_IMAGES_BUCKET
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: 1000 })
    if (error) {
      setListLoading(false)
      setListErr(error.message)
      setBucketFiles([])
      return
    }
    const dataRows = data ?? []
    setRawListCount(dataRows.length)

    const fileRows = dataRows.map((f) => ({
      name: String(f.name ?? '').trim(),
      id: (f as { id?: string | null }).id,
    }))

    let names = fileRows.filter(isStorageObjectFile).map((f) => f.name)

    if (names.length === 0 && dataRows.length > 0) {
      const folderPrefixes = fileRows
        .filter((f) => f.name && (f.id == null || f.id === '') && !f.name.includes('.'))
        .map((f) => f.name)
      for (const prefix of folderPrefixes.slice(0, 12)) {
        const nested = await supabase.storage.from(bucket).list(prefix, { limit: 500 })
        if (nested.error) continue
        const nestedRows = (nested.data ?? []).map((f) => ({
          name: String(f.name ?? '').trim(),
          id: (f as { id?: string | null }).id,
        }))
        for (const row of nestedRows.filter(isStorageObjectFile)) {
          names.push(`${prefix}/${row.name}`)
        }
      }
      names = [...new Set(names)].sort((a, b) => a.localeCompare(b))
    } else {
      names = names.sort((a, b) => a.localeCompare(b))
    }

    setBucketFiles(names)
    setListLoading(false)
  }, [])

  useEffect(() => {
    if (browseOpen) {
      setFilterQ('')
      setBrowseStep('list')
      setBrowsePreviewName('')
      setBrowsePreviewUrl('')
      setBrowseContextDraft('')
      void loadBucket()
    }
  }, [browseOpen, loadBucket])

  useEffect(() => {
    if (requestOpen) {
      setRequestDraft(String(imageRequestDescription ?? '').trim())
      setGeminiDraft(null)
      setUploadNaming(false)
      setUploadFileName('')
    }
  }, [requestOpen, imageRequestDescription])

  const suggestUploadFileName = useCallback(() => {
    const fromPrompt = wordDiscriminationImageStorageBaseName(requestDraft.trim())
    if (fromPrompt !== 'image') return fromPrompt
    return ''
  }, [requestDraft])

  const filteredFiles = useMemo(() => {
    const q = filterQ.trim().toLowerCase()
    if (!q) return bucketFiles
    return bucketFiles.filter((n) => n.toLowerCase().includes(q))
  }, [bucketFiles, filterQ])

  const img = String(image ?? '').trim()
  const req = String(imageRequestDescription ?? '').trim()
  const ctx = String(imageContext ?? '').trim()
  let statusLine = 'No image selected'
  if (img) {
    try {
      const tail = img.split('/').pop() ?? img
      statusLine = `Selected: ${decodeURIComponent(tail)}`
    } catch {
      statusLine = 'Image URL set'
    }
  } else if (req) {
    statusLine = `New image requested: ${req.length > 90 ? `${req.slice(0, 90)}…` : req}`
  }

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>Image</Text>
      <Text style={[styles.hint, !img && !req && styles.imagePickStatusEmpty]}>{statusLine}</Text>
      <Pressable style={styles.quizCorrectBtn} onPress={() => setBrowseOpen(true)}>
        <Text style={styles.quizCorrectBtnLabel}>Search available images</Text>
      </Pressable>
      <Pressable style={[styles.quizCorrectBtn, { marginTop: 8 }]} onPress={() => setRequestOpen(true)}>
        <Text style={styles.quizCorrectBtnLabel}>Request new image</Text>
        <Text style={[styles.quizCorrectBtnValue, { fontSize: 12, fontWeight: '600' }]}>
          Short note for your team (1–2 sentences)
        </Text>
      </Pressable>
      {img || req ? (
        <Pressable
          style={styles.removeBtn}
          onPress={() =>
            applyScenePatch({ image: '', imageRequestDescription: '', imageContext: '' })
          }
        >
          <Text style={styles.removeBtnText}>Clear image</Text>
        </Pressable>
      ) : null}

      {img ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>Image context (optional)</Text>
          <Text style={styles.hint}>
            1–2 sentences for your team: why this picture fits this question (stored with the lesson; not shown to
            learners).
          </Text>
          <AdminTextInput
            style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
            value={ctx}
            onChangeText={(t) => applyScenePatch({ imageContext: t })}
            placeholder="e.g. Shows the contrast we need between greeting vs. farewell…"
            placeholderTextColor="#52525b"
            allowMultiline
          />
        </View>
      ) : null}

      <Modal visible={browseOpen} transparent animationType="fade" onRequestClose={() => setBrowseOpen(false)}>
        <Pressable style={styles.quizCorrectOverlay} onPress={() => setBrowseOpen(false)}>
          <Pressable style={[styles.quizCorrectSheet, { maxHeight: 560 }]} onPress={() => {}}>
            {browseStep === 'list' ? (
              <>
                <Text style={styles.personTitle}>Search images</Text>
                <Text style={styles.hint}>
                  Filter by file name, tap a row to preview, then add optional context and confirm.
                </Text>
                <AdminTextInput
                  style={styles.input}
                  value={filterQ}
                  onChangeText={setFilterQ}
                  placeholder="Search / filter by file name…"
                  placeholderTextColor="#52525b"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {listLoading ? <Text style={styles.hint}>Loading…</Text> : null}
                {listErr ? <Text style={styles.jsonErr}>{listErr}</Text> : null}
                {!listLoading && !listErr && bucketFiles.length === 0 && rawListCount === 0 ? (
                  <Text style={styles.hint}>
                    Storage returned no files (RLS often hides objects from list). In Supabase → SQL, add a SELECT policy
                    on storage.objects for this app’s image bucket (see sql/storage_word_comparison_images_anon_list.sql).
                    Confirm EXPO_PUBLIC_SUPABASE_URL matches this project.
                  </Text>
                ) : null}
                {!listLoading && !listErr && bucketFiles.length > 0 && filteredFiles.length === 0 ? (
                  <Text style={styles.hint}>No file name matches your search.</Text>
                ) : null}
                <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                  {filteredFiles.map((name) => {
                    const { data } = supabase.storage.from(WORD_DISCRIMINATION_IMAGES_BUCKET).getPublicUrl(name)
                    const thumbUrl = data.publicUrl
                    return (
                      <Pressable
                        key={name}
                        style={[styles.quizCorrectChoice, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}
                        onPress={() => {
                          if (!thumbUrl) return
                          setBrowsePreviewName(name)
                          setBrowsePreviewUrl(thumbUrl)
                          setBrowseContextDraft(img === thumbUrl ? ctx : '')
                          setBrowseStep('preview')
                        }}
                      >
                        {thumbUrl ? (
                          <Image
                            source={{ uri: thumbUrl }}
                            style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: '#0b1220' }}
                            resizeMode="cover"
                          />
                        ) : null}
                        <Text style={[styles.quizCorrectChoiceText, { flex: 1 }]} numberOfLines={2}>
                          {name}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </>
            ) : (
              <>
                <Text style={styles.personTitle}>Use this image?</Text>
                <Text style={styles.hint} numberOfLines={2}>
                  {browsePreviewName}
                </Text>
                {browsePreviewUrl ? (
                  <View
                    style={{
                      marginTop: 8,
                      borderRadius: 12,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: 'rgba(212,175,55,0.25)',
                      backgroundColor: '#0b1220',
                    }}
                  >
                    <Image
                      source={{ uri: browsePreviewUrl }}
                      style={{ width: '100%', height: 200 }}
                      resizeMode="cover"
                    />
                  </View>
                ) : null}
                <Text style={[styles.label, { marginTop: 12 }]}>Context (optional)</Text>
                <Text style={styles.hint}>1–2 sentences — why this image fits this comparison.</Text>
                <AdminTextInput
                  style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
                  value={browseContextDraft}
                  onChangeText={setBrowseContextDraft}
                  placeholder="Optional note for your team…"
                  placeholderTextColor="#52525b"
                  allowMultiline
                />
                <Pressable
                  style={[styles.addBtn, { marginTop: 10 }]}
                  onPress={() => {
                    if (!browsePreviewUrl) return
                    const c = browseContextDraft.trim()
                    applyScenePatch({
                      image: browsePreviewUrl,
                      imageRequestDescription: '',
                      imageContext: c,
                    })
                    setBrowseOpen(false)
                  }}
                >
                  <Text style={styles.addBtnText}>Use this image</Text>
                </Pressable>
                <Pressable
                  style={[styles.removeBtn, { marginTop: 8 }]}
                  onPress={() => {
                    setBrowseStep('list')
                    setBrowsePreviewName('')
                    setBrowsePreviewUrl('')
                    setBrowseContextDraft('')
                  }}
                >
                  <Text style={styles.removeBtnText}>Back to search</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={requestOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!geminiBusy) setRequestOpen(false)
        }}
      >
        <Pressable style={styles.quizCorrectOverlay} onPress={() => !geminiBusy && setRequestOpen(false)}>
          <Pressable style={[styles.quizCorrectSheet, { maxHeight: '90%' }]} onPress={() => {}}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={{ paddingBottom: 8 }}
            >
            <Text style={styles.personTitle}>Request new image</Text>
            <Text style={styles.hint}>
              1–2 sentences for your team: what to add in Storage. Learners see this text until an image is set. You can
              also generate a draft with Gemini (same API key as document word extraction) and upload it to this bucket.
              Drafts use a 4:3 landscape frame centered like the learner discrimination screen.
            </Text>
            <AdminTextInput
              style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
              value={requestDraft}
              onChangeText={setRequestDraft}
              placeholder="Short description — e.g. Two people at a market stall, clear facial expressions…"
              placeholderTextColor="#52525b"
              allowMultiline
              editable={!geminiBusy}
            />
            {geminiBusy ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <ActivityIndicator color="#d4af37" />
                <Text style={styles.hint}>{geminiDraft ? 'Uploading…' : 'Generating…'}</Text>
              </View>
            ) : null}
            {!getExpoPublicGeminiKey().trim() ? (
              <Text style={[styles.hint, { marginTop: 8 }]}>
                Gemini generation needs EXPO_PUBLIC_GEMINI_API_KEY in your env (restart Metro after adding).
              </Text>
            ) : null}
            <Pressable
              style={[
                styles.addBtn,
                { marginTop: 10, opacity: geminiBusy || !requestDraft.trim() ? 0.45 : 1 },
              ]}
              disabled={geminiBusy || !requestDraft.trim() || !getExpoPublicGeminiKey().trim()}
              onPress={() => {
                const t = requestDraft.trim()
                if (!t || geminiBusy) return
                void (async () => {
                  setGeminiBusy(true)
                  const out = await generateWordDiscriminationImageDraft(t)
                  setGeminiBusy(false)
                  if ('error' in out) {
                    Alert.alert('Could not generate image', out.error)
                    return
                  }
                  setGeminiDraft(out)
                  setUploadNaming(false)
                  setUploadFileName('')
                })()
              }}
            >
              <Text style={styles.addBtnText}>
                {geminiDraft ? 'Regenerate draft image' : 'Generate draft image with Gemini'}
              </Text>
            </Pressable>

            {geminiDraft ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[styles.hint, { marginBottom: 8 }]}>
                  {uploadNaming ? 'Name this file, then upload' : 'Preview (not uploaded yet)'}
                </Text>
                <View
                  style={{
                    borderRadius: 12,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: 'rgba(212,175,55,0.25)',
                    backgroundColor: '#0b1220',
                  }}
                >
                  <Image
                    source={{ uri: geminiDraft.dataUrl }}
                    style={{ width: '100%', aspectRatio: WORD_DISCRIMINATION_SCENE_PREVIEW_ASPECT }}
                    resizeMode="contain"
                  />
                </View>

                {uploadNaming ? (
                  <>
                    <Text style={[styles.label, { marginTop: 12 }]}>File name</Text>
                    <Text style={styles.hint}>
                      Saved in word-comparison-images (letters, numbers, underscores). Extension is added
                      automatically.
                    </Text>
                    <AdminTextInput
                      style={styles.input}
                      value={uploadFileName}
                      onChangeText={setUploadFileName}
                      placeholder="e.g. oromo_student"
                      placeholderTextColor="#52525b"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!geminiBusy}
                    />
                    <Pressable
                      style={[
                        styles.addBtn,
                        {
                          marginTop: 10,
                          opacity:
                            geminiBusy || !wordDiscriminationImageStorageBaseName(uploadFileName) ? 0.45 : 1,
                        },
                      ]}
                      disabled={geminiBusy || !wordDiscriminationImageStorageBaseName(uploadFileName)}
                      onPress={() => {
                        if (geminiBusy || !geminiDraft) return
                        const base = wordDiscriminationImageStorageBaseName(uploadFileName)
                        if (!base) return
                        void (async () => {
                          setGeminiBusy(true)
                          const up = await uploadWordDiscriminationImageDraft(geminiDraft, base)
                          setGeminiBusy(false)
                          if ('error' in up) {
                            Alert.alert('Could not upload image', up.error)
                            return
                          }
                          applyScenePatch({ image: up.publicUrl, imageRequestDescription: '', imageContext: '' })
                          setRequestOpen(false)
                        })()
                      }}
                    >
                      <Text style={styles.addBtnText}>Upload</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.removeBtn, { marginTop: 6 }]}
                      disabled={geminiBusy}
                      onPress={() => setUploadNaming(false)}
                    >
                      <Text style={styles.removeBtnText}>Back to preview</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable
                      style={[styles.addBtn, { marginTop: 10, opacity: geminiBusy ? 0.45 : 1 }]}
                      disabled={geminiBusy}
                      onPress={() => {
                        if (geminiBusy || !geminiDraft) return
                        setUploadFileName(suggestUploadFileName())
                        setUploadNaming(true)
                      }}
                    >
                      <Text style={styles.addBtnText}>Use this image (upload)</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.removeBtn, { marginTop: 6 }]}
                      disabled={geminiBusy}
                      onPress={() => {
                        setGeminiDraft(null)
                        setUploadNaming(false)
                        setUploadFileName('')
                      }}
                    >
                      <Text style={styles.removeBtnText}>Discard draft</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}
            <Pressable
              style={[styles.addBtn, { marginTop: 8, opacity: geminiBusy ? 0.45 : 1 }]}
              disabled={geminiBusy}
              onPress={() => {
                const t = requestDraft.trim()
                if (!t) return
                applyScenePatch({ image: '', imageRequestDescription: t, imageContext: '' })
                setRequestOpen(false)
              }}
            >
              <Text style={styles.addBtnText}>Save request (text only)</Text>
            </Pressable>
            <Pressable
              style={[styles.removeBtn, { marginTop: 4 }]}
              disabled={geminiBusy}
              onPress={() => setRequestOpen(false)}
            >
              <Text style={styles.removeBtnText}>Cancel</Text>
            </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

/** Gemini generate → preview → regenerate → upload for Cultural Context screens. */
export function ImageScreenMediaField({
  image,
  imagePrompt,
  setContent,
}: {
  image: string
  imagePrompt: string
  setContent: (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => void
}) {
  const [promptDraft, setPromptDraft] = useState(() => String(imagePrompt ?? '').trim())
  const [geminiBusy, setGeminiBusy] = useState(false)
  const [geminiDraft, setGeminiDraft] = useState<WordDiscriminationImageDraft | null>(null)
  const [uploadNaming, setUploadNaming] = useState(false)
  const [uploadFileName, setUploadFileName] = useState('')

  // After a confirmed upload (image URL changes), drop any in-progress draft UI.
  useEffect(() => {
    setGeminiDraft(null)
    setUploadNaming(false)
    setUploadFileName('')
  }, [image])

  const img = String(image ?? '').trim()
  const suggestUploadFileName = () => {
    const fromPrompt = wordDiscriminationImageStorageBaseName(promptDraft.trim())
    return fromPrompt !== 'image' ? fromPrompt : ''
  }

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>Cultural context image (Gemini)</Text>
      <Text style={styles.hint}>
        Describe the scene, generate a draft, regenerate until you like it, then upload. Uses the same Gemini key and
        storage bucket as discrimination images (saved under lesson-screen/).
      </Text>
      <AdminTextInput
        style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
        value={promptDraft}
        onChangeText={(t) => {
          setPromptDraft(t)
          setContent((cur) => ({ ...cur, imagePrompt: t }))
        }}
        placeholder="e.g. Two friends greeting at a café outdoors, warm afternoon light…"
        placeholderTextColor="#52525b"
        allowMultiline
        editable={!geminiBusy}
      />
      {!getExpoPublicGeminiKey().trim() ? (
        <Text style={[styles.hint, { marginTop: 8 }]}>
          Needs EXPO_PUBLIC_GEMINI_API_KEY in .env (restart Metro after adding).
        </Text>
      ) : null}
      {geminiBusy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <ActivityIndicator color="#d4af37" />
          <Text style={styles.hint}>{geminiDraft && uploadNaming ? 'Uploading…' : 'Generating…'}</Text>
        </View>
      ) : null}
      <Pressable
        style={[
          styles.addBtn,
          { marginTop: 10, opacity: geminiBusy || !promptDraft.trim() ? 0.45 : 1 },
        ]}
        disabled={geminiBusy || !promptDraft.trim() || !getExpoPublicGeminiKey().trim()}
        onPress={() => {
          const t = promptDraft.trim()
          if (!t || geminiBusy) return
          void (async () => {
            setGeminiBusy(true)
            const out = await generateLessonImageScreenDraft(t)
            setGeminiBusy(false)
            if ('error' in out) {
              Alert.alert('Could not generate image', out.error)
              return
            }
            setGeminiDraft(out)
            setUploadNaming(false)
            setUploadFileName('')
            setContent((cur) => ({ ...cur, imagePrompt: t }))
          })()
        }}
      >
        <Text style={styles.addBtnText}>
          {geminiDraft ? 'Regenerate draft image' : 'Generate draft image with Gemini'}
        </Text>
      </Pressable>

      {geminiDraft ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.hint, { marginBottom: 8 }]}>
            {uploadNaming ? 'Name this file, then upload' : 'Preview (not uploaded yet)'}
          </Text>
          <View
            style={{
              borderRadius: 12,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(212,175,55,0.25)',
              backgroundColor: '#0b1220',
            }}
          >
            <Image
              source={{ uri: geminiDraft.dataUrl }}
              style={{ width: '100%', aspectRatio: LESSON_IMAGE_SCREEN_PREVIEW_ASPECT }}
              resizeMode="contain"
            />
          </View>
          {uploadNaming ? (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>File name</Text>
              <Text style={styles.hint}>
                Saved as lesson-screen/name in word-comparison-images. Extension is added automatically.
              </Text>
              <AdminTextInput
                style={styles.input}
                value={uploadFileName}
                onChangeText={setUploadFileName}
                placeholder="e.g. cafe_greeting"
                placeholderTextColor="#52525b"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!geminiBusy}
              />
              <Pressable
                style={[
                  styles.addBtn,
                  {
                    marginTop: 10,
                    opacity: geminiBusy || !wordDiscriminationImageStorageBaseName(uploadFileName) ? 0.45 : 1,
                  },
                ]}
                disabled={geminiBusy || !wordDiscriminationImageStorageBaseName(uploadFileName)}
                onPress={() => {
                  if (geminiBusy || !geminiDraft) return
                  const base = wordDiscriminationImageStorageBaseName(uploadFileName)
                  if (!base) return
                  void (async () => {
                    setGeminiBusy(true)
                    const up = await uploadLessonImageScreenDraft(geminiDraft, base)
                    setGeminiBusy(false)
                    if ('error' in up) {
                      Alert.alert('Could not upload image', up.error)
                      return
                    }
                    setContent((cur) => ({
                      ...cur,
                      image: up.publicUrl,
                      imagePrompt: promptDraft.trim(),
                    }))
                    setGeminiDraft(null)
                    setUploadNaming(false)
                    setUploadFileName('')
                  })()
                }}
              >
                <Text style={styles.addBtnText}>Upload & use</Text>
              </Pressable>
              <Pressable
                style={[styles.removeBtn, { marginTop: 6 }]}
                disabled={geminiBusy}
                onPress={() => setUploadNaming(false)}
              >
                <Text style={styles.removeBtnText}>Back to preview</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.addBtn, { marginTop: 10, opacity: geminiBusy ? 0.45 : 1 }]}
                disabled={geminiBusy}
                onPress={() => {
                  if (geminiBusy || !geminiDraft) return
                  setUploadFileName(suggestUploadFileName())
                  setUploadNaming(true)
                }}
              >
                <Text style={styles.addBtnText}>Use this image (upload)</Text>
              </Pressable>
              <Pressable
                style={[styles.removeBtn, { marginTop: 6 }]}
                disabled={geminiBusy}
                onPress={() => {
                  setGeminiDraft(null)
                  setUploadNaming(false)
                  setUploadFileName('')
                }}
              >
                <Text style={styles.removeBtnText}>Discard draft</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {img && !geminiDraft ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>Current image</Text>
          <Image
            source={{ uri: img }}
            style={{
              width: '100%',
              aspectRatio: LESSON_IMAGE_SCREEN_PREVIEW_ASPECT,
              borderRadius: 12,
              backgroundColor: '#1a1a1a',
            }}
            resizeMode="cover"
          />
          <Pressable
            style={styles.removeBtn}
            onPress={() => setContent((cur) => ({ ...cur, image: '' }))}
          >
            <Text style={styles.removeBtnText}>Clear image</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={[styles.label, { marginTop: 14 }]}>Or paste image URL</Text>
      <AdminTextInput
        style={styles.input}
        value={String(image ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, image: t }))}
        placeholder="https://… public image URL"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!geminiBusy}
      />
    </View>
  )
}

export function WordDiscriminationQuizEditor({
  content,
  setContent,
  lessonScreens,
  lessonSeries,
  lessonContentSeries,
  saveStructured,
  draftRef,
  setJsonError,
  registerPrimarySave,
  readOnly = false,
}: {
  content: Record<string, unknown>
  setContent: (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => void
  lessonScreens: LessonScreen[]
  lessonSeries: string | null
  lessonContentSeries: string | null
  saveStructured: (c: Record<string, unknown>) => void
  draftRef: MutableRefObject<LessonScreen | null>
  setJsonError: (s: string) => void
  registerPrimarySave?: (fn: () => void) => void
  readOnly?: boolean
}) {
  const [seriesLabels, setSeriesLabels] = useState<string[]>([])
  const harvested = useMemo(() => harvestWordsFromLessonScreens(lessonScreens as unknown[]), [lessonScreens])

  useEffect(() => {
    let cancel = false
    void (async () => {
      const labels = await buildWordBankLookupLabels(lessonSeries, lessonContentSeries)
      if (!cancel) setSeriesLabels(labels)
    })()
    return () => {
      cancel = true
    }
  }, [lessonSeries, lessonContentSeries])

  const runDiscriminationPrimarySave = useCallback(() => {
    void (async () => {
      setJsonError('')
      const d = draftRef.current
      if (!d) return
      const payload = { ...(d.content as Record<string, unknown>) }
      const sharedQ = String(payload.question ?? payload.title ?? payload.prompt ?? '').trim()
      if (!sharedQ) {
        setJsonError('Enter the Title Question (shown above images for every question).')
        return
      }
      const wordsRaw = (payload.words as Record<string, unknown>[] | undefined) ?? []
      if (!Array.isArray(wordsRaw) || wordsRaw.length < 2) {
        setJsonError('Add at least two words.')
        return
      }
      const texts: string[] = []
      for (let wi = 0; wi < wordsRaw.length; wi++) {
        const wr = wordsRaw[wi]
        if (!wr || typeof wr !== 'object' || Array.isArray(wr)) {
          setJsonError(`Word ${wi + 1} is invalid.`)
          return
        }
        const tw = String((wr as Record<string, unknown>).text ?? '').trim()
        if (!tw) {
          setJsonError(`Word ${wi + 1}: pick or enter a word.`)
          return
        }
        texts.push(tw)
      }
      const seen = new Set<string>()
      for (const tw of texts) {
        const k = celebrateAfaanDedupeKey(tw)
        if (seen.has(k)) {
          setJsonError('All words on this screen must be different.')
          return
        }
        seen.add(k)
      }
      const hw = harvestWordsFromLessonScreens(lessonScreens as unknown[])
      for (let wi = 0; wi < texts.length; wi++) {
        const ok = await isWordAllowedForDiscrimination(
          texts[wi],
          lessonSeries,
          lessonContentSeries,
          hw,
        )
        if (!ok) {
          setJsonError(
            'Each word must appear in this lesson (any screen) or exist in the series word bank. Adjust titles/series or pick again.',
          )
          return
        }
      }
      const resolvedWords: Record<string, unknown>[] = []
      for (let wi = 0; wi < wordsRaw.length; wi++) {
        const wr = wordsRaw[wi] as Record<string, unknown>
        const tw = texts[wi]
        const def = await resolveDiscriminationDefinition(tw, lessonSeries, lessonContentSeries, hw)
        const entry: Record<string, unknown> = { text: tw, definition: def }
        const wid = wr.word_id
        if (typeof wid === 'string' && isUuidLike(wid) && !wid.startsWith(LESSON_PICK_ID_PREFIX)) {
          entry.word_id = wid
        }
        resolvedWords.push(entry)
      }
      const nWords = resolvedWords.length
      const scRaw = (payload.scenes as Record<string, unknown>[] | undefined) ?? []
      if (!Array.isArray(scRaw) || scRaw.length === 0) {
        setJsonError('Add at least one question.')
        return
      }
      const outScenes: Record<string, unknown>[] = []
      for (let si = 0; si < scRaw.length; si++) {
        const s = scRaw[si]
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
          setJsonError(`Question ${si + 1} is invalid.`)
          return
        }
        const sr = s as Record<string, unknown>
        const img = String(sr.image ?? '').trim()
        const reqDesc = String(sr.imageRequestDescription ?? '').trim()
        const imgCtx = String(sr.imageContext ?? '').trim()
        const expl = String(sr.explanation ?? '').trim()
        if (!img && !reqDesc) {
          setJsonError(`Question ${si + 1}: choose an available image or enter a new-image request.`)
          return
        }
        if (!expl) {
          setJsonError(`Question ${si + 1}: explanation required.`)
          return
        }
        let cwi =
          typeof sr.correctWordIndex === 'number' && Number.isFinite(sr.correctWordIndex)
            ? Math.floor(sr.correctWordIndex)
            : String(sr.correct ?? 'A').toUpperCase().startsWith('B')
              ? 1
              : 0
        if (cwi < 0 || cwi >= nWords) cwi = 0
        const sceneOut: Record<string, unknown> = {
          image: img,
          explanation: expl,
          correctWordIndex: cwi,
        }
        if (reqDesc && !img) {
          sceneOut.imageRequestDescription = reqDesc
        }
        if (img && imgCtx) {
          sceneOut.imageContext = imgCtx
        }
        outScenes.push(sceneOut)
      }
      payload.question = sharedQ
      delete payload.title
      delete payload.prompt
      delete payload.wordA
      delete payload.wordB
      delete payload.word_a
      delete payload.word_b
      delete payload.definitionA
      delete payload.definitionB
      delete payload.wordA_id
      delete payload.wordB_id
      payload.words = resolvedWords
      payload.scenes = outScenes
      payload.streakTarget = nWords
      saveStructured(payload)
    })()
  }, [draftRef, lessonScreens, lessonSeries, lessonContentSeries, saveStructured, setJsonError])

  useLayoutEffect(() => {
    if (!registerPrimarySave) return
    if (readOnly) {
      registerPrimarySave(() => {})
      return () => registerPrimarySave(() => {})
    }
    registerPrimarySave(runDiscriminationPrimarySave)
    return () => registerPrimarySave(() => {})
  }, [registerPrimarySave, runDiscriminationPrimarySave, readOnly])

  let words = (content.words as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(words) || words.length < 2) {
    words = [
      { text: '', definition: '' },
      { text: '', definition: '' },
    ]
  }

  let scenes = (content.scenes as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(scenes) || scenes.length === 0) {
    scenes = [{ image: '', imageRequestDescription: '', imageContext: '', correctWordIndex: 0, explanation: '' }]
  }

  const wordPickerLabels = words.map((w, idx) => {
    const t = String(w?.text ?? '').trim()
    return t || `Word ${idx + 1} (empty)`
  })

  const applyWordPick = (wordIndex: number, row: WordBankRow) => {
    const afaan = rowAfaanText(row)
    const gloss = rowTranslationText(row)
    const persistId = isUuidLike(row.id) && !row.id.startsWith(LESSON_PICK_ID_PREFIX)
    setContent((cur) => {
      const arr = [...((cur.words as Record<string, unknown>[]) ?? [])]
      while (arr.length <= wordIndex) arr.push({ text: '', definition: '' })
      const prev = { ...(arr[wordIndex] ?? {}) }
      prev.text = afaan
      prev.definition = gloss
      if (persistId) prev.word_id = row.id
      else delete prev.word_id
      arr[wordIndex] = prev
      return { ...cur, words: arr }
    })
  }

  const clearWordSlot = (wordIndex: number) => {
    setContent((cur) => {
      const arr = [...((cur.words as Record<string, unknown>[]) ?? [])]
      if (!arr[wordIndex]) return cur
      const next = { ...arr[wordIndex] }
      next.text = ''
      next.definition = ''
      delete next.word_id
      arr[wordIndex] = next
      return { ...cur, words: arr }
    })
  }

  return (
    <View style={styles.form}>
      <Field
        label="Title Question"
        value={String(content.question ?? content.title ?? content.prompt ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, question: t }))}
      />
      <Text style={styles.label}>Words on this screen</Text>
      <Text style={styles.hint}>Pick at least two words to compare.</Text>

      {words.map((w, i) => {
        const wt = String(w?.text ?? '').trim()
        return (
          <View key={`wdq-word-${i}`} style={{ marginBottom: 14 }}>
            <Text style={styles.personTitle}>Word {i + 1}</Text>
            {wt ? (
              <View style={styles.matchSelectedBox}>
                <Text style={styles.matchSelectedTop}>{wt}</Text>
                <Text style={styles.matchSelectedSub}>{String(w?.definition ?? '').trim() || '—'}</Text>
                <Pressable style={styles.changeWordBtn} onPress={() => clearWordSlot(i)}>
                  <Text style={styles.changeWordBtnText}>Change word</Text>
                </Pressable>
              </View>
            ) : (
              <LessonAndSeriesWordPicker
                seriesLabels={seriesLabels}
                lessonHarvested={harvested}
                onPick={(row) => applyWordPick(i, row)}
                hint={
                  !seriesLabels.length && i === 0
                    ? 'No series labels yet — lesson-only tokens below; link series for bank search.'
                    : undefined
                }
              />
            )}
            {words.length > 2 ? (
              <Pressable
                style={styles.removeBtn}
                onPress={() => {
                  setContent((cur) => {
                    const arr = [...((cur.words as Record<string, unknown>[]) ?? [])]
                    if (arr.length <= 2) return cur
                    const nextWords = arr.filter((_, j) => j !== i)
                    const scList = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
                    const nextScenes = scList.map((s) => {
                      let idx =
                        typeof s.correctWordIndex === 'number' && Number.isFinite(s.correctWordIndex)
                          ? Math.floor(s.correctWordIndex)
                          : 0
                      if (idx === i) idx = 0
                      else if (idx > i) idx -= 1
                      const maxI = Math.max(0, nextWords.length - 1)
                      if (idx > maxI) idx = maxI
                      if (idx < 0) idx = 0
                      return { ...s, correctWordIndex: idx }
                    })
                    return { ...cur, words: nextWords, scenes: nextScenes }
                  })
                }}
              >
                <Text style={styles.removeBtnText}>Remove word</Text>
              </Pressable>
            ) : null}
          </View>
        )
      })}

      <Pressable
        style={styles.addBtn}
        onPress={() =>
          setContent((cur) => {
            const arr = [...((cur.words as Record<string, unknown>[]) ?? [])]
            return { ...cur, words: [...arr, { text: '', definition: '' }] }
          })
        }
      >
        <Text style={styles.addBtnText}>+ Add word</Text>
      </Pressable>

      <Text style={styles.label}>Questions</Text>
      <Text style={styles.hint}>
        Each question: pick the correct word, then search the image library (with optional team context) or request a
        new image.
      </Text>
      {scenes.map((sc, i) => {
        const cwi =
          typeof sc.correctWordIndex === 'number' && Number.isFinite(sc.correctWordIndex)
            ? Math.floor(sc.correctWordIndex)
            : 0
        return (
          <View key={i} style={styles.pairCard}>
            <Text style={styles.personTitle}>Question {i + 1}</Text>
            <SceneCorrectWordPicker
              wordLabels={wordPickerLabels}
              valueIndex={cwi}
              onSelect={(idx) => {
                setContent((cur) => {
                  const arr = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
                  const wArr = (cur.words as unknown[] | undefined) ?? []
                  const maxI = Math.max(0, wArr.length - 1)
                  const v = Math.max(0, Math.min(maxI, idx))
                  const next = arr.map((x, j) => (j === i ? { ...x, correctWordIndex: v } : x))
                  return { ...cur, scenes: next }
                })
              }}
            />
            <WordDiscriminationSceneImageField
              sceneIndex={i}
              image={String(sc.image ?? '')}
              imageRequestDescription={String(sc.imageRequestDescription ?? '')}
              imageContext={String(sc.imageContext ?? '')}
              setContent={setContent}
            />
            <Field
              label="Explanation (after answering)"
              value={String(sc.explanation ?? '')}
              allowMultiline
              onChangeText={(t) => {
                setContent((cur) => {
                  const arr = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
                  const next = arr.map((x, j) => (j === i ? { ...x, explanation: t } : x))
                  return { ...cur, scenes: next }
                })
              }}
            />
            <Pressable
              style={styles.removeBtn}
              onPress={() => {
                setContent((cur) => {
                  const arr = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
                  return { ...cur, scenes: arr.filter((_, j) => j !== i) }
                })
              }}
            >
              <Text style={styles.removeBtnText}>Remove question</Text>
            </Pressable>
          </View>
        )
      })}
      <Pressable
        style={styles.addBtn}
        onPress={() =>
          setContent((cur) => {
            const arr = [...((cur.scenes as Record<string, unknown>[]) ?? [])]
            return {
              ...cur,
              scenes: [
                ...arr,
                { image: '', imageRequestDescription: '', imageContext: '', correctWordIndex: 0, explanation: '' },
              ],
            }
          })
        }
      >
        <Text style={styles.addBtnText}>+ Add question</Text>
      </Pressable>
    </View>
  )
}

export function WordBankPicker({
  label,
  value,
  onPick,
  placeholder = 'Search word bank…',
}: {
  label: string
  value: WordBankRow | null
  onPick: (row: WordBankRow) => void
  placeholder?: string
}) {
  const ro = useLessonEditorReadOnly()
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<WordBankRow[]>([])
  const [err, setErr] = useState('')
  const lastReq = useRef(0)

  useEffect(() => {
    if (ro) {
      setRows([])
      setErr('')
      setLoading(false)
      return
    }
    const query = q.trim()
    if (query.length < 2) {
      setRows([])
      setErr('')
      return
    }
    const reqId = ++lastReq.current
    setLoading(true)
    setErr('')
    const t = setTimeout(() => {
      void (async () => {
        const isUuid = isUuidLike(query)
        const base = supabase.from('words').select(WORD_BANK_LIST_COLUMNS).limit(25)
        const res = isUuid
          ? await base.eq('id', query)
          : await base.or(`word.ilike.%${query}%,translation.ilike.%${query}%`)
        if (reqId !== lastReq.current) return
        setLoading(false)
        if (res.error) {
          setErr(res.error.message)
          setRows([])
          return
        }
        setRows(((res.data as WordBankRow[] | null) ?? []).filter((r) => typeof r?.id === 'string'))
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [q, ro])

  return (
    <View style={styles.wordPicker}>
      <Text style={styles.label}>{label}</Text>
      {value ? <Text style={styles.wordPicked}>{wordLabel(value)}</Text> : <Text style={styles.wordNone}>None</Text>}
      {ro ? null : (
      <AdminTextInput
        style={styles.input}
        value={q}
        onChangeText={setQ}
        placeholder={placeholder}
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        autoCorrect={false}
      />
      )}
      {!ro && loading ? <Text style={styles.hint}>Searching…</Text> : null}
      {!ro && err ? <Text style={styles.jsonErr}>{err}</Text> : null}
      {!ro && rows.length ? (
        <View style={styles.wordResults}>
          {rows.map((r) => (
            <Pressable
              key={r.id}
              style={styles.wordResultRow}
              onPress={() => {
                onPick(r)
                setQ('')
                setRows([])
              }}
            >
              <View style={styles.wordResultTextCol}>
                <Text style={styles.wordResultTextTop}>{rowAfaanTextForBankPick(r) || r.id}</Text>
                {rowTranslationText(r) ? (
                  <Text style={styles.wordResultTextSub}>{rowTranslationText(r)}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** Afaan Oromo field with debounced word-bank matches (same query as WordBankPicker). */
export function AudioExposureOromoField({
  value,
  onChangeText,
  onPickFromBank,
  compact = false,
  hideLabel = false,
  onEditorFocus,
  instanceKey,
  externalFocusKey,
  readOnly = false,
  lessonHarvested = [],
}: {
  value: string
  onChangeText: (t: string) => void
  onPickFromBank: (row: WordBankRow) => void
  /** Tighter layout (e.g. video review line vocab). */
  compact?: boolean
  /** Hide “Afaan Oromo” when a parent label (e.g. “Vocab Words”) is shown above. */
  hideLabel?: boolean
  /** Runs when the text field gains focus (e.g. activate this line in video review). */
  onEditorFocus?: () => void
  /** Stable id for this field (e.g. `${lineId}-w${index}`) when using `externalFocusKey`. */
  instanceKey?: string
  /** When set to another field’s `instanceKey` or `${lineId}:line`, this field’s suggestion list closes. */
  externalFocusKey?: string
  /** After picking from the word bank (`word_id` set), text is not editable — remove the row/word to change. */
  readOnly?: boolean
  /** Other Audio exposure words in this lesson (not yet in DB) — merged into matches like word-bank rows. */
  lessonHarvested?: HarvestedWord[]
}) {
  const ctxReadOnly = useLessonEditorReadOnly()
  const bankReadOnly = readOnly || ctxReadOnly
  const [rows, setRows] = useState<WordBankRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const lastReq = useRef(0)
  const blurHideSuggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSuggestBlurTimer = useCallback(() => {
    if (blurHideSuggestTimerRef.current) {
      clearTimeout(blurHideSuggestTimerRef.current)
      blurHideSuggestTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearSuggestBlurTimer(), [clearSuggestBlurTimer])

  useEffect(() => {
    if (!instanceKey || externalFocusKey === undefined) return
    if (externalFocusKey === instanceKey) return
    // Hide dropdown only; keep `rows` so refocusing this field still shows matches without retyping.
    setSuggestOpen(false)
  }, [externalFocusKey, instanceKey])

  useEffect(() => {
    if (bankReadOnly) {
      setRows([])
      setErr('')
      setSuggestOpen(false)
      return
    }
    const query = value.trim()
    if (query.length < 2) {
      setRows([])
      setErr('')
      return
    }
    const reqId = ++lastReq.current
    setLoading(true)
    setErr('')
    const t = setTimeout(() => {
      void (async () => {
        const { data, error } = await fetchWordBankRows(query)
        if (reqId !== lastReq.current) return
        setLoading(false)
        if (error || data == null) {
          setErr(error?.message ?? 'Search failed')
          setRows([])
          return
        }
        setErr('')
        setRows(mergeDbAndLessonHarvestForPicker(data, lessonHarvested, query))
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [value, bankReadOnly, lessonHarvested])

  return (
    <View style={compact ? styles.fieldVideoReviewOromo : styles.field}>
      {hideLabel ? null : (
        <Text style={[styles.label, compact && styles.labelVideoReviewCompact]}>Afaan Oromo</Text>
      )}
      <AdminTextInput
        style={[
          styles.input,
          compact && styles.inputVideoReviewCompact,
          bankReadOnly && styles.inputReadOnlyBank,
        ]}
        value={value}
        editable={!bankReadOnly}
        onChangeText={onChangeText}
        onFocus={() => {
          onEditorFocus?.()
          if (!bankReadOnly) setSuggestOpen(true)
        }}
        onBlur={() => {
          clearSuggestBlurTimer()
          blurHideSuggestTimerRef.current = setTimeout(() => {
            blurHideSuggestTimerRef.current = null
            setSuggestOpen(false)
          }, 320)
        }}
        placeholder={
          bankReadOnly
            ? ''
            : compact
              ? hideLabel
                ? 'Search word bank (2+ letters) or type a word'
                : 'Type or search word bank (2+ letters)'
              : 'Type or search the word bank (2+ letters show matches)'
        }
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {suggestOpen && loading ? <Text style={styles.hint}>Searching word bank…</Text> : null}
      {suggestOpen && err ? <Text style={styles.jsonErr}>{err}</Text> : null}
      {suggestOpen && !loading && rows.length ? (
        <View style={styles.wordResults}>
          {rows.map((r) => (
            <Pressable
              key={r.id}
              style={styles.wordResultRow}
              onPress={() => {
                clearSuggestBlurTimer()
                onPickFromBank(r)
                setSuggestOpen(false)
                setRows([])
              }}
            >
              <View style={styles.wordResultTextCol}>
                <Text style={styles.wordResultTextTop}>{rowAfaanTextForBankPick(r) || r.id}</Text>
                {rowTranslationText(r) ? (
                  <Text style={styles.wordResultTextSub}>{rowTranslationText(r)}</Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function cloneScreen(s: LessonScreen): LessonScreen {
  return JSON.parse(JSON.stringify(s)) as LessonScreen
}

export function modalContentDirty(
  draft: LessonScreen,
  jsonFallback: string,
  baseline: LessonScreen,
  baselineJsonText: string,
): boolean {
  if (JSON.stringify(draft) !== JSON.stringify(baseline)) return true
  try {
    const cur = JSON.stringify(JSON.parse(jsonFallback))
    const base = JSON.stringify(JSON.parse(baselineJsonText))
    return cur !== base
  } catch {
    return jsonFallback.trim() !== baselineJsonText.trim()
  }
}

export function modalContentDirtyForRole(
  allowJsonEditing: boolean,
  draft: LessonScreen,
  jsonFallback: string,
  baseline: LessonScreen,
  baselineJsonText: string,
  readOnly?: boolean,
): boolean {
  if (readOnly) return false
  if (!allowJsonEditing) {
    return JSON.stringify(draft) !== JSON.stringify(baseline)
  }
  return modalContentDirty(draft, jsonFallback, baseline, baselineJsonText)
}

export function InfoCircleButton(props: { onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      hitSlop={8}
      style={styles.infoBtn}
      accessibilityRole="button"
      accessibilityLabel="How this works"
    >
      <Text style={styles.infoBtnText}>i</Text>
    </Pressable>
  )
}

/** Up to 6 ready-made discussion messages (learner app: Dubbadhu/utils/discussionPills.js). */
export const MAX_DISCUSSION_PILLS = 6

export function DiscussionPillsField(props: {
  label: string
  hint: string
  value: unknown
  onChange: (next: string[] | undefined) => void
}) {
  const ro = useLessonEditorReadOnly()
  const pills: string[] = Array.isArray(props.value)
    ? props.value.map((x) => String(x ?? ''))
    : typeof props.value === 'string' && props.value.trim()
      ? props.value.split(/[\n,]/).map((x) => x.trim())
      : []
  const update = (next: string[]) => props.onChange(next.length ? next.slice(0, MAX_DISCUSSION_PILLS) : undefined)
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <Text style={styles.hint}>{props.hint}</Text>
      {pills.map((pill, i) => (
        <View key={i} style={styles.bulletRow}>
          <AdminTextInput
            style={styles.bulletInput}
            value={pill}
            editable={!ro}
            onChangeText={(t) => update(pills.map((x, j) => (j === i ? t.slice(0, 60) : x)))}
            placeholder={`Pill ${i + 1}`}
            placeholderTextColor="#52525b"
          />
          <Pressable style={styles.bulletMiniBtn} onPress={() => update(pills.filter((_, j) => j !== i))} disabled={ro}>
            <Text style={styles.bulletMiniBtnTextDanger}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.addBtn}
        onPress={() => update([...pills, ''])}
        disabled={ro || pills.length >= MAX_DISCUSSION_PILLS}
      >
        <Text style={[styles.addBtnText, pills.length >= MAX_DISCUSSION_PILLS && styles.bulletMiniDisabled]}>+ Add pill</Text>
      </Pressable>
    </View>
  )
}

export function Field(props: {
  label: string
  value: string
  onChangeText: (t: string) => void
  /** Return adds new lines (scripts, long notes). Default: Done dismisses keyboard. */
  allowMultiline?: boolean
  /** Taller field that scrolls; still uses Done (not Return) unless `allowMultiline`. */
  multilineCompact?: boolean
  /** @deprecated Use `allowMultiline` */
  multiline?: boolean
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad'
  onFocus?: () => void
  editable?: boolean
  onInfoPress?: () => void
}) {
  const ro = useLessonEditorReadOnly()
  const allowMl = props.allowMultiline === true || props.multiline === true
  const compact = !!props.multilineCompact
  const useMultilineLayout = allowMl || compact
  const editable = props.editable !== false && !ro
  return (
    <View style={styles.field}>
      {props.onInfoPress ? (
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInRow]}>{props.label}</Text>
          <InfoCircleButton onPress={props.onInfoPress} />
        </View>
      ) : (
        <Text style={styles.label}>{props.label}</Text>
      )}
      <AdminTextInput
        style={[
          styles.input,
          useMultilineLayout && !compact && styles.inputMulti,
          compact && styles.inputMultiCompact,
          !editable && styles.inputReadOnlyBank,
        ]}
        value={props.value}
        editable={editable}
        onChangeText={props.onChangeText}
        onFocus={props.onFocus}
        allowMultiline={allowMl}
        multiline={useMultilineLayout}
        scrollEnabled={compact}
        keyboardType={props.keyboardType}
        placeholderTextColor="#52525b"
      />
    </View>
  )
}

export function Row(props: { label: string; children: ReactNode; onInfoPress?: () => void }) {
  return (
    <View style={styles.rowSwitch}>
      <View style={[styles.labelRow, styles.rowSwitchLabel]}>
        <Text style={[styles.label, styles.labelInRow]}>{props.label}</Text>
        {props.onInfoPress ? <InfoCircleButton onPress={props.onInfoPress} /> : null}
      </View>
      {props.children}
    </View>
  )
}

export const styles = StyleSheet.create({
  modalRoot: { flex: 1, backgroundColor: '#0a0a0a' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  modalCancel: { color: '#a78bfa', fontSize: 16, fontWeight: '600' },
  modalHeaderSave: { minWidth: 56, alignItems: 'flex-end', justifyContent: 'center', paddingVertical: 2 },
  modalHeaderSaveText: { color: '#22c55e', fontSize: 16, fontWeight: '700' },
  modalTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  modalScroll: { flex: 1 },
  modalScrollContent: { flexGrow: 1, padding: 16, paddingBottom: 48 },
  screenHeader: { marginBottom: 12 },
  screenHeaderTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'left' },
  screenHeaderSubtitle: { color: '#a1a1aa', fontSize: 13, marginTop: 6, textAlign: 'left', lineHeight: 18 },
  hint: { color: '#a1a1aa', fontSize: 14, marginBottom: 12 },
  lengthWarn: { color: '#fbbf24', fontSize: 13, marginTop: -4, marginBottom: 12 },
  imagePickStatusEmpty: { color: '#f87171' },
  form: { marginBottom: 20 },
  dialogueVideoReference: {
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 12,
    backgroundColor: '#111',
    padding: 10,
    marginBottom: 12,
  },
  dialogueVideoHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dialogueOpenVideoBtn: {
    borderWidth: 1,
    borderColor: '#d4af37',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  dialogueOpenVideoText: { color: '#fde68a', fontSize: 12, fontWeight: '800' },
  dialogueThumbRow: { flexDirection: 'row', gap: 8 },
  dialogueThumbCell: { flex: 1 },
  dialogueThumbBox: {
    height: 100,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogueThumb: { width: '100%', height: '100%' },
  dialogueThumbLabel: {
    color: '#d4d4d8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 5,
  },
  field: { marginBottom: 14 },
  label: { color: '#d4d4d8', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  labelInRow: { marginBottom: 0, flexShrink: 1 },
  rowSwitchLabel: { flex: 1, marginBottom: 0, marginRight: 12 },
  infoBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#71717a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBtnText: { fontSize: 11, color: '#a1a1aa', fontWeight: '700' },
  input: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  inputMulti: { minHeight: 88, textAlignVertical: 'top' },
  inputMultiCompact: {
    minHeight: 44,
    maxHeight: 120,
    textAlignVertical: 'top',
    paddingTop: 10,
    paddingBottom: 10,
  },
  rowSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  personCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  personTitle: { color: '#e4e4e7', fontWeight: '700', marginBottom: 8 },
  pairCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  videoReviewLineCard: {
    backgroundColor: '#18181b',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  videoReviewLineTitle: {
    color: '#e4e4e7',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  videoReviewLineTitleInRow: { flex: 1, marginBottom: 0, minWidth: 0 },
  videoReviewLineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  videoReviewHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 0 },
  videoReviewRemoveLineBtnHeader: { paddingVertical: 2, paddingLeft: 4 },
  videoReviewWordRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  videoReviewWordCol: { flex: 1, minWidth: 0 },
  videoReviewEnglishHint: {
    color: '#a1a1aa',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  videoReviewRemoveWordBtn: { marginTop: 10, flexShrink: 0, paddingVertical: 2, paddingLeft: 2 },
  videoReviewAddWordBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#27272a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  videoReviewAddWordBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  videoReviewCollapsedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  videoReviewExpandLink: { color: '#a78bfa', fontSize: 14, fontWeight: '700' },
  videoReviewCollapsedScript: {
    color: '#e4e4e7',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  videoReviewCollapsedWords: {
    color: '#d4d4d8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  videoReviewCollapsedMeta: { color: '#71717a', fontSize: 11, marginBottom: 6 },
  videoReviewMinimizeBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#52525b',
    backgroundColor: '#111',
  },
  videoReviewMinimizeBtnText: { color: '#d4d4d8', fontSize: 13, fontWeight: '600' },
  fieldVideoReviewOromo: { marginBottom: 2 },
  labelVideoReviewCompact: { fontSize: 11, marginBottom: 4, color: '#a1a1aa' },
  inputVideoReviewCompact: { paddingVertical: 8, fontSize: 14 },
  inputReadOnlyBank: { color: '#a1a1aa', opacity: 0.95 },
  row2: { flexDirection: 'row', alignItems: 'flex-start' },
  wordRow: { marginBottom: 10 },
  removeBtn: { marginTop: 8, alignSelf: 'flex-start' },
  removeBtnText: { color: '#f87171', fontSize: 14, fontWeight: '600' },
  addBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#27272a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },
  matchEmptyBlock: { marginBottom: 8 },
  fillFromExposureBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#1a1a1c',
  },
  fillFromExposureBtnText: { color: '#e4e4e7', fontSize: 15, fontWeight: '700' },
  fillFromExposureBtnSub: { color: '#71717a', fontSize: 12, marginTop: 6, lineHeight: 16 },
  wordPicker: { marginBottom: 14 },
  wordPicked: { color: '#e4e4e7', fontSize: 14, marginBottom: 8 },
  wordNone: { color: '#71717a', fontSize: 14, marginBottom: 8 },
  wordResults: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  wordResultRow: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#27272a' },
  wordResultTextCol: { gap: 2 },
  wordResultTextTop: { color: '#e4e4e7', fontSize: 14, fontWeight: '700' },
  wordResultTextSub: { color: '#a1a1aa', fontSize: 13 },
  matchRightPreviewLabel: { color: '#d4d4d8', fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  matchRightPreview: {
    color: '#a1a1aa',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 10,
  },
  matchSelectedBox: {
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    backgroundColor: '#111',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  matchSelectedTop: { color: '#e4e4e7', fontSize: 15, fontWeight: '800' },
  matchSelectedSub: { color: '#a1a1aa', fontSize: 13, marginTop: 4, lineHeight: 18 },
  changeWordBtn: { marginTop: 10, alignSelf: 'flex-start' },
  changeWordBtnText: { color: '#a78bfa', fontSize: 14, fontWeight: '700' },
  learnedBlock: { marginTop: 8, marginBottom: 6 },
  learnedList: { marginTop: 8, gap: 8 },
  learnedReadOnlyRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#111',
  },
  learnedText: { color: '#e4e4e7', fontSize: 14 },
  learnedReadOnlySub: { color: '#a1a1aa', fontSize: 13, marginTop: 4 },
  quizQuestionShell: {
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#0c0c0d',
    overflow: 'hidden',
  },
  quizQuestionHeader: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#18181b',
  },
  quizQuestionHeaderTap: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  quizQuestionHeaderMeta: { flex: 1, minWidth: 0 },
  quizQuestionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  quizQuestionChevron: { color: '#eab308', fontSize: 16, fontWeight: '900', width: 22, textAlign: 'center' },
  quizQuestionLabel: { color: '#eab308', fontSize: 13, fontWeight: '800' },
  quizQuestionSummary: { color: '#a1a1aa', fontSize: 12, marginTop: 4 },
  quizQuestionRemoveHeader: { justifyContent: 'center', paddingHorizontal: 12, borderLeftWidth: 1, borderLeftColor: '#27272a' },
  quizQuestionRemoveHeaderText: { color: '#f87171', fontSize: 13, fontWeight: '800' },
  quizQuestionBody: { paddingHorizontal: 12, paddingBottom: 14, paddingTop: 4 },
  quizOptionCard: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  quizOptionTextCol: { flex: 1, minWidth: 0 },
  quizOptionTop: { color: '#e4e4e7', fontSize: 15, fontWeight: '800' },
  quizOptionSub: { color: '#a1a1aa', fontSize: 13, marginTop: 4, lineHeight: 18 },
  quizOptionAudioHint: { color: '#34c759', fontSize: 11, fontWeight: '600', marginTop: 6 },
  quizOptionRemoveBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#27272a' },
  quizOptionRemoveText: { color: '#f87171', fontSize: 13, fontWeight: '800' },
  textQuizOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  textQuizRadioTap: { paddingVertical: 4 },
  textQuizRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#52525b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textQuizRadioOn: { borderColor: '#22c55e' },
  textQuizRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22c55e',
  },
  textQuizOptionInput: { flex: 1 },
  textQuizOptionInputOn: { borderColor: 'rgba(34,197,94,0.55)' },
  quizCorrectBtn: {
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#18181b',
  },
  quizCorrectBtnLabel: { color: '#d4d4d8', fontSize: 13, fontWeight: '700' },
  quizCorrectBtnValue: { color: '#fff', fontSize: 15, fontWeight: '800', marginTop: 6 },
  quizCorrectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  quizCorrectSheet: {
    backgroundColor: '#0a0a0a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 14,
  },
  quizCorrectChoice: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#111',
    marginTop: 10,
  },
  quizCorrectChoiceOn: {
    borderColor: 'rgba(232,135,10,0.85)',
    backgroundColor: 'rgba(232,135,10,0.16)',
  },
  quizCorrectChoiceText: { color: '#e4e4e7', fontSize: 14, fontWeight: '800' },
  quizCorrectChoiceSub: { color: '#a1a1aa', fontSize: 13, marginTop: 4, lineHeight: 18 },
  warningBox: {
    backgroundColor: '#2a1a00',
    borderWidth: 1,
    borderColor: '#a16207',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  warningTitle: { color: '#fbbf24', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  warningBody: { color: '#fde68a', fontSize: 12, lineHeight: 16, marginBottom: 10 },
  convertBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#a16207',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  convertBtnText: { color: '#111', fontWeight: '800' },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  bulletInput: {
    flex: 1,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  bulletMiniBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletMiniBtnText: { color: '#fff', fontWeight: '800' },
  bulletMiniBtnTextDanger: { color: '#f87171', fontWeight: '900' },
  bulletMiniDisabled: { opacity: 0.35 },
  saveStructured: {
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  saveStructuredTextSave: { color: '#0a0a0a', fontWeight: '800', fontSize: 16 },
  advancedLabel: { color: '#fbbf24', fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  jsonInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    padding: 12,
    color: '#e4e4e7',
    fontSize: 12,
    minHeight: 120,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  jsonErr: { color: '#f87171', marginBottom: 8 },
  saveErrorBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248, 113, 113, 0.45)',
  },
  saveErrorBannerTitle: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 6,
  },
  saveErrorBannerText: {
    color: '#fecaca',
    fontSize: 13,
    lineHeight: 19,
  },
  previewBelowForm: {
    marginTop: 20,
  },
  modalHeaderSaveDisabled: {
    opacity: 0.45,
  },
  applyJsonBtn: {
    marginTop: 12,
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyJsonText: { color: '#fff', fontWeight: '700' },
})