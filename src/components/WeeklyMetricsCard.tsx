import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { ADMIN_ACCENT_GOLD } from './lesson-config/AdminLessonConfigChrome'
import { findMetric } from '../lib/revenueCatMetrics'
import { loadMrrBurnState } from '../lib/mrrBurnStorage'
import supabase from '../lib/supabase'
import { fetchWeeklyMetrics, type WeekCompare, type WeeklyMetrics } from '../lib/weeklyMetrics'

const UP = '#5ECF6E'
const DOWN = '#f87171'

type Revenue = { value: number; period: string; unit: string; fetchedAt: string } | null

function delta(c: WeekCompare): { text: string; color: string } {
  const d = c.now - c.prev
  if (d === 0) return { text: `same as last week (${c.prev})`, color: '#8e8e93' }
  return { text: `${d > 0 ? '+' : ''}${d} vs ${c.prev} last week`, color: d > 0 ? UP : DOWN }
}

function pct(n: number, base: number): string {
  return base > 0 ? `${Math.round((n / base) * 100)}%` : '—'
}

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Admin home: this week's signups, week-1 return, trials, paid and revenue (src/lib/weeklyMetrics.ts). */
export default function WeeklyMetricsCard({ onPress }: { onPress: () => void }) {
  const [data, setData] = useState<WeeklyMetrics | null>(null)
  const [revenue, setRevenue] = useState<Revenue>(null)
  const [error, setError] = useState('')

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        const [res, state] = await Promise.all([fetchWeeklyMetrics(supabase), loadMrrBurnState()])
        if (cancelled) return
        setData(res.data)
        setError(res.error ?? '')
        const snap = state.lastRevenueCat
        const m = snap ? findMetric(snap.overview, 'revenue') : null
        setRevenue(m && snap ? { value: m.value, period: m.period, unit: m.unit, fetchedAt: snap.fetchedAt } : null)
      })()
      return () => {
        cancelled = true
      }
    }, []),
  )

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="This week's metrics. Opens Analytics."
    >
      <View style={styles.headRow}>
        <Text style={styles.title}>This week</Text>
        <Text style={styles.sub}>
          {data ? `${shortDate(data.weekStart)} → today (UTC) · test accounts left out` : ''}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={ADMIN_ACCENT_GOLD} style={{ marginTop: 10 }} /> : null}
      {data ? (
        <View style={styles.grid}>
          <View style={styles.tile}>
            <Text style={styles.value}>{data.signups.now}</Text>
            <Text style={styles.label}>Signups</Text>
            <Text style={[styles.meta, { color: delta(data.signups).color }]}>{delta(data.signups).text}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.value}>{data.week1 ? pct(data.week1.returned, data.week1.base) : '—'}</Text>
            <Text style={styles.label}>Week-1 return</Text>
            {data.week1 ? (
              <Text style={styles.meta}>
                {data.week1.returned}/{data.week1.base} who joined week of {shortDate(data.week1.cohortStart)} · week
                before {pct(data.week1.prevReturned, data.week1.prevBase)}
              </Text>
            ) : null}
          </View>
          <View style={styles.tile}>
            <Text style={styles.value}>{data.trials.now}</Text>
            <Text style={styles.label}>Trials started</Text>
            <Text style={[styles.meta, { color: delta(data.trials).color }]}>{delta(data.trials).text}</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.value}>{data.paidTotal}</Text>
            <Text style={styles.label}>Paid learners</Text>
            <Text style={styles.meta}>{data.paidActive} still Premium · all time</Text>
          </View>
          <View style={[styles.tile, styles.tileWide]}>
            <Text style={styles.value}>
              {revenue ? `$${Math.round(revenue.value).toLocaleString()}` : '—'}
            </Text>
            <Text style={styles.label}>Revenue (RevenueCat)</Text>
            <Text style={styles.meta}>
              {revenue
                ? `${revenue.period || 'last 28 days'} · as of ${new Date(revenue.fetchedAt).toLocaleDateString()}`
                : 'Open MRR & burn once to load RevenueCat'}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  pressed: { opacity: 0.85 },
  headRow: { marginBottom: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sub: { color: '#8e8e93', fontSize: 12, marginTop: 2 },
  error: { color: DOWN, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.5%', backgroundColor: '#1c1c1e', borderRadius: 12, padding: 10 },
  tileWide: { width: '100%' },
  value: { color: '#fff', fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { color: '#d1d5db', fontSize: 12, fontWeight: '600', marginTop: 2 },
  meta: { color: '#8e8e93', fontSize: 11, lineHeight: 15, marginTop: 3 },
})
