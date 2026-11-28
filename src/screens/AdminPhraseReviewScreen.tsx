import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { AdminTextInput } from '../components/AdminTextInput'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { useAuth } from '../context/AuthContext'
import { fetchReviewQueue, saveReview, type ReviewItem, type ReviewStatus } from '../lib/phraseReviews'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminPhraseReview'>

const SOURCE_LABEL: Record<ReviewItem['source'], string> = { blog: 'Blog draft', word: 'Word bank', lesson: 'Lesson' }
const GREEN = '#4ade80'

function sourceLine(i: ReviewItem): string {
  if (i.source === 'blog') return i.sourceRef.replace('docs/blog-drafts/', '')
  return SOURCE_LABEL[i.source]
}

export default function AdminPhraseReviewScreen({ navigation }: Props) {
  const { adminEmail } = useAuth()
  const [items, setItems] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const [fixing, setFixing] = useState<string | null>(null)
  const [fixText, setFixText] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Phrase review' })
  }, [navigation])

  const load = useCallback(async () => {
    const res = await fetchReviewQueue(supabase)
    setItems(res.data)
    setError(res.error ?? '')
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load().then(() => setLoading(false))
    }, [load]),
  )

  const save = useCallback(
    async (item: ReviewItem, status: ReviewStatus, fixedText?: string) => {
      setSavingKey(item.key)
      const { error: err } = await saveReview(supabase, item, { status, fixedText, reviewer: adminEmail })
      setSavingKey(null)
      if (err) {
        Alert.alert('Could not save', err)
        return
      }
      setFixing(null)
      await load()
    },
    [adminEmail, load],
  )

  const pending = useMemo(() => items.filter((i) => i.status === 'pending'), [items])
  const done = useMemo(
    () => items.filter((i) => i.status !== 'pending').sort((a, b) => String(b.reviewedAt).localeCompare(String(a.reviewedAt))),
    [items],
  )
  const shown = tab === 'pending' ? pending : done

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ADMIN_ACCENT_GOLD} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
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
      <View style={styles.tabs}>
        {(
          [
            { key: 'pending' as const, label: `To check (${pending.length})` },
            { key: 'done' as const, label: `Done (${done.length})` },
          ] as const
        ).map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {shown.length === 0 ? (
        <Text style={styles.muted}>{tab === 'pending' ? 'Nothing waiting for a native speaker.' : 'No reviews yet.'}</Text>
      ) : null}

      {shown.map((item) => {
        const busy = savingKey === item.key
        return (
          <View key={item.key} style={styles.card}>
            <Text style={styles.source}>{sourceLine(item)}</Text>
            <Text style={styles.phrase}>{item.phrase}</Text>
            {item.context && item.context !== item.phrase ? (
              <Text style={styles.context} numberOfLines={4}>
                {item.context}
              </Text>
            ) : null}

            {item.status !== 'pending' ? (
              <>
                <Text style={[styles.verdict, { color: item.status === 'approved' ? GREEN : ADMIN_ACCENT_GOLD }]}>
                  {item.status === 'approved' ? 'Approved' : `Fixed → ${item.fixedText ?? ''}`}
                </Text>
                <Text style={styles.by}>
                  {item.reviewedBy ?? 'admin'}
                  {item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString()}` : ''}
                </Text>
                <Pressable onPress={() => void save(item, 'pending')} disabled={busy} hitSlop={6}>
                  <Text style={styles.link}>Reopen</Text>
                </Pressable>
              </>
            ) : fixing === item.key ? (
              <>
                <AdminTextInput
                  style={styles.input}
                  value={fixText}
                  onChangeText={setFixText}
                  placeholder="The right wording"
                  placeholderTextColor="#6b7280"
                  autoFocus
                />
                <View style={styles.btnRow}>
                  <Pressable style={styles.btn} onPress={() => setFixing(null)}>
                    <Text style={styles.btnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.btn, styles.btnPrimary, (!fixText.trim() || busy) && styles.disabled]}
                    onPress={() => void save(item, 'fixed', fixText)}
                    disabled={!fixText.trim() || busy}
                  >
                    <Text style={styles.btnPrimaryText}>Save fix</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.btnRow}>
                <Pressable
                  style={styles.btn}
                  onPress={() => {
                    setFixing(item.key)
                    setFixText(item.phrase)
                  }}
                  disabled={busy}
                >
                  <Text style={styles.btnText}>Fix</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, busy && styles.disabled]}
                  onPress={() => void save(item, 'approved')}
                  disabled={busy}
                >
                  <Text style={styles.btnPrimaryText}>{busy ? '…' : 'Approve'}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )
      })}
      <Text style={styles.foot}>
        Blog fixes don't edit the markdown: the blog writer applies them. Word reviews are a record only; change the word
        in Vocab Center or the recording queue.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  error: { color: '#f87171', fontSize: 12, marginBottom: 8 },
  muted: { color: '#8e8e93', fontSize: 13, marginTop: 12 },
  tabs: { flexDirection: 'row', backgroundColor: '#2a2a2a', borderRadius: 8, padding: 2, marginBottom: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6 },
  tabOn: { backgroundColor: '#3a3a3c' },
  tabText: { color: '#888', fontSize: 13, fontWeight: '500' },
  tabTextOn: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#141414', borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#222' },
  source: { color: '#8e8e93', fontSize: 11 },
  phrase: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 3 },
  context: { color: '#9ca3af', fontSize: 12, lineHeight: 16, marginTop: 4 },
  verdict: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  by: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  link: { color: ADMIN_ACCENT_GOLD, fontSize: 13, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: '#1c1c1e',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    fontSize: 15,
  },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1c1c1e' },
  btnText: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  btnPrimary: { backgroundColor: ADMIN_ACCENT_GOLD },
  btnPrimaryText: { color: '#000', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  foot: { color: '#6b7280', fontSize: 11, lineHeight: 15, marginTop: 16 },
})
