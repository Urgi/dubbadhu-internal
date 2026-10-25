import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { useRemoteAudioUrl } from '../hooks/useRemoteAudioUrl'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminWarmup'>

/** One row of the `warmup_lesson_words` view (words a lesson teaches, in screen order). */
type LessonWordRow = {
  lesson_id: string
  series_id: string
  lesson_number: number
  screen_index: number
  item_index: number
  screen_type: string
  word_id: string
}

type WordRow = {
  id: string
  word: string | null
  translation: string | null
  fast_audio_url: string | null
  status: string | null
  warmup_excluded: boolean | null
}

type SeriesRow = { id: string; title: string | null; sort_order: number | null; series_status: string | null }

type Candidate = {
  word: WordRow
  seriesId: string
  /** Position of the series in lesson_series.sort_order (for "lessons up to here"). */
  seriesOrder: number
  lessonNumber: number
  lessonTitle: string
  taughtOn: string
  /** Why the learner app can't ask it (null = usable). Mirrors isWarmupWord in Dubbadhu/utils/warmup.js. */
  blocked: string | null
}

type Filter = 'all' | 'on' | 'off' | 'blocked'

const SCREEN_LABEL: Record<string, string> = {
  audioExposure: 'listening',
  speakingPractice: 'speaking',
  'word-breakdown': 'word breakdown',
  discriminationDrill: 'sound drill',
  match: 'match',
  videoReview: 'video review',
  quiz: 'quiz answer',
}

/** Same checks as the learner app's isWarmupWord, minus the admin switch (shown separately). */
function blockedReason(w: WordRow): string | null {
  const word = String(w.word || '').trim()
  const english = String(w.translation || '').trim()
  if (w.status && w.status !== 'approved') return `Not approved (${w.status})`
  if (!w.fast_audio_url) return 'No audio'
  if (!word) return 'No Oromo text'
  if (!english) return 'No English meaning'
  if (english.includes('[deprecated]')) return 'Deprecated'
  if (/[_{}]/.test(word)) return 'Has a blank or name slot'
  return null
}

function tokens(text: string): string[] {
  return text.replace(/[?.!,]/g, '').split(/\s+/).filter(Boolean)
}

function englishCore(text: string): string {
  return text.replace(/\([^)]*\)/g, '').replace(/[^a-z' ]/gi, '').trim().toLowerCase()
}

/**
 * Question previews for a learner who just finished this candidate's lesson. Mirrors the shapes of
 * buildQuestion in Dubbadhu/utils/warmup.js (easy: hear → 2 meanings; medium: 3 audio options, or
 * word tiles with look-alike extras for 2+ word phrases). Wrong options are the first matches, not random.
 */
function previews(target: Candidate, pool: Candidate[]) {
  const t = target.word
  const core = englishCore(String(t.translation))
  const known = pool.filter(
    (c) =>
      !c.blocked &&
      !c.word.warmup_excluded &&
      c.word.id !== t.id &&
      (c.seriesOrder < target.seriesOrder ||
        (c.seriesOrder === target.seriesOrder && c.lessonNumber <= target.lessonNumber)),
  )
  const others = known.filter((c) => englishCore(String(c.word.translation)) !== core)
  const sameLesson = others.filter((c) => c.seriesId === target.seriesId && c.lessonNumber === target.lessonNumber)
  const ordered = [...sameLesson, ...others.filter((c) => !sameLesson.includes(c))]
  const wrong = (n: number) => {
    const seen = new Set([core])
    const out: Candidate[] = []
    for (const c of ordered) {
      const k = englishCore(String(c.word.translation))
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
      if (out.length >= n) break
    }
    return out
  }
  const answer = tokens(String(t.word))
  const lookalikes = [
    ...new Set(
      known
        .flatMap((c) => tokens(String(c.word.word)))
        .filter((w) => !answer.map((a) => a.toLowerCase()).includes(w.toLowerCase()))
        .filter((w) => answer.some((a) => a.length >= 3 && w.toLowerCase().slice(0, 3) === a.toLowerCase().slice(0, 3))),
    ),
  ].slice(0, 2)
  return {
    easy: wrong(1),
    medium: wrong(2),
    tiles: answer.length >= 2 ? [...answer, ...lookalikes] : null,
  }
}

export default function AdminWarmupScreen({ navigation }: Props) {
  const [series, setSeries] = useState<SeriesRow[]>([])
  const [seriesId, setSeriesId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [preview, setPreview] = useState<Candidate | null>(null)
  const { playUrl, playingId } = useRemoteAudioUrl()

  const load = useCallback(async () => {
    setError('')
    const [{ data: seriesRows, error: sErr }, { data: lessonRows, error: lErr }, { data: taughtRows, error: tErr }] =
      await Promise.all([
        supabase.from('lesson_series').select('id, title, sort_order, series_status').order('sort_order'),
        supabase.from('lessons').select('id, title, series_id, lesson_number'),
        supabase
          .from('warmup_lesson_words')
          .select('lesson_id, series_id, lesson_number, screen_index, item_index, screen_type, word_id'),
      ])
    const err = sErr || lErr || tErr
    if (err) {
      setError(err.message)
      return
    }
    const seriesList = ((seriesRows || []) as SeriesRow[]).filter((s) => s.series_status !== 'archived')
    const order = new Map(seriesList.map((s, i) => [s.id, i]))
    const titleByLesson = new Map(
      ((lessonRows || []) as { id: string; title: string | null }[]).map((l) => [l.id, l.title || l.id]),
    )
    // First lesson that teaches a word wins (series order, lesson, screen, item) — same as the learner app.
    const rows = ((taughtRows || []) as LessonWordRow[])
      .filter((r) => order.has(r.series_id))
      .sort(
        (a, b) =>
          (order.get(a.series_id) ?? 0) - (order.get(b.series_id) ?? 0) ||
          a.lesson_number - b.lesson_number ||
          a.screen_index - b.screen_index ||
          a.item_index - b.item_index,
      )
    const first = new Map<string, LessonWordRow>()
    for (const r of rows) if (!first.has(r.word_id)) first.set(r.word_id, r)
    const ids = [...first.keys()]
    const words: WordRow[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: wErr } = await supabase
        .from('words')
        .select('id, word, translation, fast_audio_url, status, warmup_excluded')
        .in('id', ids.slice(i, i + 200))
      if (wErr) {
        setError(wErr.message)
        return
      }
      words.push(...((data || []) as WordRow[]))
    }
    const byId = new Map(words.map((w) => [w.id, w]))
    const list: Candidate[] = []
    for (const [id, r] of first) {
      const w = byId.get(id)
      if (!w) continue
      list.push({
        word: w,
        seriesId: r.series_id,
        seriesOrder: order.get(r.series_id) ?? 0,
        lessonNumber: r.lesson_number,
        lessonTitle: titleByLesson.get(r.lesson_id) || r.lesson_id,
        taughtOn: SCREEN_LABEL[r.screen_type] || r.screen_type,
        blocked: blockedReason(w),
      })
    }
    setSeries(seriesList)
    setSeriesId((cur) => cur ?? seriesList.find((s) => s.series_status === 'published')?.id ?? seriesList[0]?.id ?? null)
    setCandidates(list)
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        setLoading(true)
        await load()
        if (!cancelled) setLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }, [load]),
  )

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Warm-up questions',
      headerStyle: { backgroundColor: '#000000' },
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: '#ffffff',
    })
  }, [navigation])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const toggle = useCallback(async (c: Candidate, include: boolean) => {
    setSaving(c.word.id)
    setCandidates((list) =>
      list.map((x) => (x.word.id === c.word.id ? { ...x, word: { ...x.word, warmup_excluded: !include } } : x)),
    )
    const { error: err } = await supabase.from('words').update({ warmup_excluded: !include }).eq('id', c.word.id)
    if (err) {
      setError(err.message)
      setCandidates((list) =>
        list.map((x) => (x.word.id === c.word.id ? { ...x, word: { ...x.word, warmup_excluded: include } } : x)),
      )
    }
    setSaving(null)
  }, [])

  const inSeries = useMemo(() => candidates.filter((c) => c.seriesId === seriesId), [candidates, seriesId])
  const counts = useMemo(
    () => ({
      on: inSeries.filter((c) => !c.blocked && !c.word.warmup_excluded).length,
      off: inSeries.filter((c) => !c.blocked && c.word.warmup_excluded).length,
      blocked: inSeries.filter((c) => c.blocked).length,
    }),
    [inSeries],
  )
  const visible = inSeries.filter((c) =>
    filter === 'on'
      ? !c.blocked && !c.word.warmup_excluded
      : filter === 'off'
        ? !c.blocked && !!c.word.warmup_excluded
        : filter === 'blocked'
          ? !!c.blocked
          : true,
  )
  const lessons = [...new Set(visible.map((c) => c.lessonNumber))].sort((a, b) => a - b)
  const preview3 = preview ? previews(preview, candidates) : null

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={ADMIN_ACCENT_GOLD} />
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {series.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setSeriesId(s.id)}
            style={[styles.chip, seriesId === s.id && styles.chipOn]}
          >
            <Text style={[styles.chipText, seriesId === s.id && styles.chipTextOn]}>
              {s.title || s.id}
              {s.series_status !== 'published' ? ' (draft)' : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.chipRow}>
        {(
          [
            ['all', `All ${inSeries.length}`],
            ['on', `In warm-up ${counts.on}`],
            ['off', `Switched off ${counts.off}`],
            ['blocked', `Can't use ${counts.blocked}`],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipOn]}>
            <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        <Text style={styles.hint}>
          Every word a lesson teaches can be a warm-up question once a learner finishes that lesson. Turn a word off to
          keep it out of the warm-up for everyone (takes effect on their next warm-up, no app update). Tap a word to
          preview its questions.
        </Text>
        {visible.length === 0 ? <Text style={styles.empty}>Nothing here.</Text> : null}
        {lessons.map((n) => {
          const inLesson = visible.filter((c) => c.lessonNumber === n)
          return (
            <View key={n} style={styles.lessonBlock}>
              <Text style={styles.lessonTitle}>
                Lesson {n} · {inLesson[0]?.lessonTitle}
              </Text>
              {inLesson.map((c) => {
                const included = !c.blocked && !c.word.warmup_excluded
                return (
                  <Pressable
                    key={c.word.id}
                    onPress={() => (c.blocked ? null : setPreview(c))}
                    style={[styles.card, !included && styles.cardOff]}
                  >
                    <View style={styles.cardRow}>
                      <Pressable
                        hitSlop={8}
                        onPress={() => void playUrl(c.word.fast_audio_url, c.word.id)}
                        disabled={!c.word.fast_audio_url}
                        style={[styles.play, !c.word.fast_audio_url && styles.playDisabled]}
                      >
                        <Text style={styles.playText}>{playingId === c.word.id ? '■' : '▶'}</Text>
                      </Pressable>
                      <View style={styles.cardBody}>
                        <Text style={styles.oromo}>{c.word.word || '—'}</Text>
                        <Text style={styles.english}>{c.word.translation || '—'}</Text>
                        <Text style={styles.meta}>
                          Taught on {c.taughtOn}
                          {c.blocked
                            ? ''
                            : ` · ${tokens(String(c.word.word)).length >= 2 ? 'Hear it · Pick the audio · Word tiles' : 'Hear it · Pick the audio'}`}
                        </Text>
                        {c.blocked ? <Text style={styles.blocked}>Can't use: {c.blocked}</Text> : null}
                      </View>
                      <Switch
                        value={included}
                        disabled={!!c.blocked || saving === c.word.id}
                        onValueChange={(v) => void toggle(c, v)}
                        trackColor={{ true: ADMIN_ACCENT_GOLD, false: '#333' }}
                      />
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )
        })}
      </ScrollView>

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.modalRoot} onPress={() => setPreview(null)}>
          <Pressable style={styles.modalCard} onPress={() => null}>
            {preview && preview3 ? (
              <>
                <Text style={styles.modalTitle}>
                  {preview.word.word} · {preview.word.translation}
                </Text>
                <Text style={styles.modalSub}>As a learner who just finished lesson {preview.lessonNumber} sees it</Text>

                <Text style={styles.qLabel}>EASY · Listen, then choose the meaning</Text>
                <Text style={styles.qLine}>▶ {preview.word.word}</Text>
                {[preview, ...preview3.easy].map((o, i) => (
                  <Text key={o.word.id} style={[styles.qOption, o === preview && styles.qRight]}>
                    {String.fromCharCode(65 + i)}. {o.word.translation}
                  </Text>
                ))}
                {preview3.easy.length < 1 ? <Text style={styles.blocked}>Not enough other words yet</Text> : null}

                <Text style={styles.qLabel}>MEDIUM · Which one says “{preview.word.translation}”</Text>
                {[preview, ...preview3.medium].map((o, i) => (
                  <Text key={o.word.id} style={[styles.qOption, o === preview && styles.qRight]}>
                    {String.fromCharCode(65 + i)}. ▶ {o.word.word}
                  </Text>
                ))}
                {preview3.medium.length < 2 ? (
                  <Text style={styles.blocked}>Needs 2 other words; learners get the easy question instead</Text>
                ) : null}

                {preview3.tiles ? (
                  <>
                    <Text style={styles.qLabel}>MEDIUM · Build it in Afaan Oromo</Text>
                    <Text style={styles.qLine}>{preview3.tiles.join('  ·  ')}</Text>
                    <Text style={styles.modalSub}>Answer: {tokens(String(preview.word.word)).join(' ')}</Text>
                  </>
                ) : null}

                <Text style={styles.modalNote}>
                  Wrong options shown are the first matches; learners get a random pick from the same pool.
                </Text>
                <Pressable style={styles.modalBtn} onPress={() => setPreview(null)}>
                  <Text style={styles.modalBtnText}>Close</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
  },
  chipOn: { borderColor: ADMIN_ACCENT_GOLD, backgroundColor: 'rgba(212,164,55,0.12)' },
  chipText: { color: '#aaa', fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: ADMIN_ACCENT_GOLD },
  hint: { color: '#888', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  empty: { color: '#777', marginTop: 20 },
  error: { color: '#f87171', paddingHorizontal: 16, marginTop: 8 },
  lessonBlock: { marginBottom: 18 },
  lessonTitle: { color: ADMIN_ACCENT_GOLD, fontWeight: '700', fontSize: 13, marginBottom: 8 },
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
    marginBottom: 8,
  },
  cardOff: { opacity: 0.55 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardBody: { flex: 1 },
  play: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ADMIN_ACCENT_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { borderColor: '#333' },
  playText: { color: ADMIN_ACCENT_GOLD, fontSize: 13 },
  oromo: { color: '#fff', fontWeight: '700', fontSize: 16 },
  english: { color: '#bbb', fontSize: 14, marginTop: 2 },
  meta: { color: '#777', fontSize: 12, marginTop: 4 },
  blocked: { color: '#f59e0b', fontSize: 12, marginTop: 4 },
  modalRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#121212', borderRadius: 14, borderWidth: 1, borderColor: '#333', padding: 16 },
  modalTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },
  modalSub: { color: '#888', fontSize: 12, marginTop: 4 },
  qLabel: { color: ADMIN_ACCENT_GOLD, fontWeight: '700', fontSize: 11, letterSpacing: 0.8, marginTop: 16, marginBottom: 6 },
  qLine: { color: '#ddd', fontSize: 14, marginBottom: 4 },
  qOption: { color: '#ccc', fontSize: 14, paddingVertical: 3 },
  qRight: { color: '#4ade80', fontWeight: '700' },
  modalNote: { color: '#666', fontSize: 11, marginTop: 14 },
  modalBtn: { alignSelf: 'flex-end', marginTop: 12, paddingHorizontal: 14, paddingVertical: 10 },
  modalBtnText: { color: ADMIN_ACCENT_GOLD, fontWeight: '700' },
})
