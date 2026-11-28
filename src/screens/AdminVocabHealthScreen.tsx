import { useCallback, useLayoutEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { fetchVocabHealth, type VocabSectionHealth } from '../lib/vocabHealth'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminVocabHealth'>

const RED = '#f87171'
const GREEN = '#4ade80'
const AMBER = '#fbbf24'

function wordProblem(w: VocabSectionHealth['words'][number]): string {
  if (w.hasAudio) return w.hasPicture ? '' : 'no picture'
  if (!w.bankStatus) return 'not in the word bank'
  if (w.bankStatus === 'approved') return 'no audio file'
  return `in recording queue (${w.bankStatus})`
}

export default function AdminVocabHealthScreen({ navigation }: Props) {
  const [sections, setSections] = useState<VocabSectionHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Vocab health' })
  }, [navigation])

  const load = useCallback(async () => {
    const res = await fetchVocabHealth(supabase)
    setSections(res.data)
    setError(res.error ?? '')
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load().then(() => setLoading(false))
    }, [load]),
  )

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ADMIN_ACCENT_GOLD} />
      </View>
    )
  }

  const empty = sections.filter((s) => s.opensEmpty && !s.hiddenInApp)
  const totals = sections.reduce(
    (t, s) => ({ words: t.words + s.total, audio: t.audio + s.withAudio, pics: t.pics + s.withPicture }),
    { words: 0, audio: 0, pics: 0 },
  )

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={ADMIN_ACCENT_GOLD}
          onRefresh={() => {
            setRefreshing(true)
            void load().then(() => setRefreshing(false))
          }}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.summary}>
        {totals.audio} of {totals.words} words play in the app · {totals.pics} have a picture
      </Text>
      {empty.length ? (
        <Text style={[styles.summary, { color: RED }]}>
          {empty.length} section(s) open empty, so the app hides them: {empty.map((s) => s.label).join(', ')}
        </Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.queueBtn, pressed && styles.pressed]}
        onPress={() => navigation.navigate('AdminSeriesList')}
        accessibilityRole="button"
      >
        <Text style={styles.queueBtnText}>Open recording queue ›</Text>
      </Pressable>

      {sections.map((s) => {
        const problems = s.words.filter((w) => !w.hasAudio || !w.hasPicture)
        const expanded = open === s.key
        const dot = s.opensEmpty ? RED : s.withAudio < s.total ? AMBER : GREEN
        return (
          <Pressable
            key={s.key}
            style={styles.row}
            onPress={() => setOpen(expanded ? null : s.key)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <View style={styles.rowHead}>
              <View style={[styles.dot, { backgroundColor: dot }]} />
              <Text style={styles.rowTitle}>{s.label}</Text>
              {s.opensEmpty ? <Text style={styles.emptyTag}>Opens empty</Text> : null}
              {s.hiddenInApp ? <Text style={styles.hiddenTag}>hidden in app</Text> : null}
            </View>
            <Text style={styles.rowMeta}>
              {s.total} words · {s.total - s.withAudio} missing audio · {s.total - s.withPicture} missing picture
            </Text>
            {expanded
              ? problems.map((w) => (
                  <Text key={w.oromo} style={styles.word}>
                    <Text style={styles.wordOromo}>{w.oromo}</Text> ({w.english}) ·{' '}
                    <Text style={{ color: w.hasAudio ? '#9ca3af' : RED }}>{wordProblem(w)}</Text>
                  </Text>
                ))
              : null}
          </Pressable>
        )
      })}
      <Text style={styles.foot}>
        Sections come from the learner app's VocabularyData.js (run npm run sync:vocab-sections after it changes). A word
        plays when a word-bank row with the same Afaan Oromo text has an audio URL.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  error: { color: RED, fontSize: 12, marginBottom: 8 },
  summary: { color: '#d1d5db', fontSize: 13, marginBottom: 6 },
  queueBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 8,
  },
  queueBtnText: { color: ADMIN_ACCENT_GOLD, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  row: { backgroundColor: '#141414', borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#222' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  emptyTag: { color: RED, fontSize: 11, fontWeight: '700' },
  hiddenTag: { color: '#8e8e93', fontSize: 11 },
  rowMeta: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
  word: { color: '#d1d5db', fontSize: 12, marginTop: 6 },
  wordOromo: { color: '#fff', fontWeight: '600' },
  foot: { color: '#6b7280', fontSize: 11, lineHeight: 15, marginTop: 16 },
})
