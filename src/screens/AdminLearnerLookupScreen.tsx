import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { StackScreenProps } from '@react-navigation/stack'
import { AdminTextInput } from '../components/AdminTextInput'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { useAuth } from '../context/AuthContext'
import {
  fetchLearnerTimeline,
  learnerDisplayName,
  searchLearners,
  type LearnerMatch,
  type TimelineCategory,
  type TimelineItem,
} from '../lib/learnerLookup'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminLearnerLookup'>

type Filter = 'all' | 'money' | 'lessons' | 'problems'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'money', label: 'Money' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'problems', label: 'Problems' },
]

const CATEGORY_COLOR: Record<TimelineCategory, string> = {
  signup: '#60a5fa',
  lessons: '#4ade80',
  money: ADMIN_ACCENT_GOLD,
  problems: '#f87171',
  email: '#c084fc',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function premiumLine(u: LearnerMatch): string {
  if (!u.isPremium) return u.premium_source ? `Free (was ${u.premium_source})` : 'Free'
  const parts = [`Premium · ${u.premium_source ?? 'unknown source'}`]
  if (u.premium_product_id) parts.push(u.premium_product_id)
  if (u.premium_expires_at) parts.push(`until ${new Date(u.premium_expires_at).toLocaleDateString()}`)
  if (u.premium_will_renew === false) parts.push('renewal off')
  return parts.join(' · ')
}

export default function AdminLearnerLookupScreen({ navigation }: Props) {
  const { role } = useAuth()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [matches, setMatches] = useState<LearnerMatch[]>([])
  const [selected, setSelected] = useState<LearnerMatch | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState('')
  const searchSeq = useRef(0)

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Learner lookup' })
  }, [navigation])

  // Debounced search; ignore late answers from older queries.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setMatches([])
      return
    }
    const seq = ++searchSeq.current
    const t = setTimeout(() => {
      setSearching(true)
      void searchLearners(supabase, q).then((res) => {
        if (seq !== searchSeq.current) return
        setSearching(false)
        setMatches(res.data)
        setError(res.error ?? '')
      })
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const openLearner = useCallback(async (u: LearnerMatch) => {
    setSelected(u)
    setTimeline([])
    setFilter('all')
    setTimelineLoading(true)
    const res = await fetchLearnerTimeline(supabase, u.id)
    setTimeline(res.data)
    setTruncated(res.truncated)
    setError(res.error ?? '')
    setTimelineLoading(false)
  }, [])

  const shown = useMemo(
    () =>
      filter === 'all'
        ? timeline
        : timeline.filter((i) => i.category === filter),
    [filter, timeline],
  )

  if (role !== 'admin') {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Admins only.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AdminTextInput
        style={styles.search}
        value={query}
        onChangeText={(t) => {
          setQuery(t)
          setSelected(null)
        }}
        placeholder="Name, email or phone"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!selected ? (
        <>
          {searching ? <ActivityIndicator color={ADMIN_ACCENT_GOLD} style={{ marginTop: 12 }} /> : null}
          {!searching && query.trim().length >= 2 && matches.length === 0 ? (
            <Text style={styles.muted}>No learners match.</Text>
          ) : null}
          {matches.map((u) => (
            <Pressable
              key={u.id}
              style={({ pressed }) => [styles.matchRow, pressed && styles.pressed]}
              onPress={() => void openLearner(u)}
              accessibilityRole="button"
            >
              <Text style={styles.matchName}>
                {learnerDisplayName(u)}
                {u.exclude_from_analytics ? <Text style={styles.testTag}>  test account</Text> : null}
              </Text>
              <Text style={styles.matchMeta} numberOfLines={1}>
                {[u.email, u.phone, u.created_at && `joined ${new Date(u.created_at).toLocaleDateString()}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <View style={styles.headerCard}>
            <Text style={styles.headerName}>{learnerDisplayName(selected)}</Text>
            <Text style={styles.headerMeta}>{[selected.email, selected.phone].filter(Boolean).join(' · ')}</Text>
            <Text style={styles.headerMeta}>{premiumLine(selected)}</Text>
            <Text style={styles.headerId} selectable>
              {selected.id}
            </Text>
          </View>
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, filter === f.key && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f.key }}
              >
                <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
          {timelineLoading ? <ActivityIndicator color={ADMIN_ACCENT_GOLD} style={{ marginTop: 12 }} /> : null}
          {!timelineLoading && shown.length === 0 ? <Text style={styles.muted}>Nothing here yet.</Text> : null}
          {shown.map((item) => (
            <View key={item.id} style={styles.item}>
              <View style={[styles.itemDot, { backgroundColor: CATEGORY_COLOR[item.category] }]} />
              <View style={styles.itemText}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : null}
                <Text style={styles.itemWhen}>{formatWhen(item.at)}</Text>
              </View>
            </View>
          ))}
          {truncated ? <Text style={styles.muted}>Showing the newest 500 events.</Text> : null}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  search: {
    backgroundColor: '#1c1c1e',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  error: { color: '#f87171', fontSize: 12, marginTop: 8 },
  muted: { color: '#8e8e93', fontSize: 13, marginTop: 12 },
  matchRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  pressed: { opacity: 0.6 },
  matchName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  testTag: { color: '#fbbf24', fontSize: 12, fontWeight: '600' },
  matchMeta: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  headerCard: { backgroundColor: '#141414', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  headerName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerMeta: { color: '#d1d5db', fontSize: 13, marginTop: 4 },
  headerId: { color: '#6b7280', fontSize: 11, marginTop: 6 },
  filters: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#1c1c1e' },
  chipOn: { backgroundColor: '#3a3a3c' },
  chipText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  item: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  itemDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  itemText: { flex: 1, minWidth: 0 },
  itemTitle: { color: '#fff', fontSize: 14 },
  itemDetail: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  itemWhen: { color: '#6b7280', fontSize: 11, marginTop: 2 },
})
