import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ADMIN_ACCENT_GOLD } from './lesson-config/AdminLessonConfigChrome'
import type { SeriesReadiness } from '../lib/seriesReadiness'

const GREEN = '#4ade80'
const RED = '#f87171'

/** Red/green publish checklist (src/lib/seriesReadiness.ts). */
export default function SeriesReadinessCard({
  readiness,
  error,
  loading,
  onRefresh,
}: {
  readiness: SeriesReadiness | null
  error: string | null
  loading: boolean
  onRefresh: () => void
}) {
  const redCount = readiness ? readiness.checks.filter((c) => !c.ok).length : 0
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Ready to publish</Text>
        {loading ? (
          <ActivityIndicator size="small" color={ADMIN_ACCENT_GOLD} />
        ) : (
          <Pressable onPress={onRefresh} hitSlop={8} accessibilityRole="button" accessibilityLabel="Check again">
            <Text style={styles.refresh}>Check again</Text>
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {readiness ? (
        <>
          <Text style={[styles.summary, { color: readiness.ready ? GREEN : RED }]}>
            {readiness.ready ? 'All green. You can publish.' : `${redCount} to fix before publishing.`}
          </Text>
          {readiness.checks.map((c) => (
            <View key={c.id} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: c.ok ? GREEN : RED }]} />
              <View style={styles.rowText}>
                <Text style={styles.label}>{c.label}</Text>
                {!c.ok && c.detail ? <Text style={styles.detail}>{c.detail}</Text> : null}
              </View>
            </View>
          ))}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
    marginTop: 12,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  refresh: { color: ADMIN_ACCENT_GOLD, fontSize: 13, fontWeight: '600' },
  summary: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  error: { color: RED, fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  rowText: { flex: 1, minWidth: 0 },
  label: { color: '#e5e5e5', fontSize: 13 },
  detail: { color: '#9ca3af', fontSize: 12, lineHeight: 16, marginTop: 2 },
})
