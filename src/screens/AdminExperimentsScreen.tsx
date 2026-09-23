import { useCallback, useLayoutEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
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
import {
  emptyResults,
  fetchExperimentFlag,
  fetchExperimentResults,
  upsertExperimentFlag,
  type ExperimentDateRange,
  type ExperimentResults,
} from '../lib/experimentResults'
import { KNOWN_EXPERIMENTS, type KnownExperiment } from '../lib/experiments'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminExperiments'>

type FlagState = {
  enabled: boolean
  updatedAt: string | null
}

const CARD_BG = '#1c1c1e'
const SCREEN_BG = '#0a0a0a'

function formatRangeLabel(results: ExperimentResults): string {
  if (!results.sinceIso) return 'All time'
  return `${new Date(results.sinceIso).toLocaleDateString()} – ${new Date(results.untilIso).toLocaleDateString()}`
}

function ExperimentCard({
  experiment,
  flag,
  results,
  range,
  saving,
  onRange,
  onToggle,
}: {
  experiment: KnownExperiment
  flag: FlagState | null
  results: ExperimentResults
  range: ExperimentDateRange
  saving: boolean
  onRange: (next: ExperimentDateRange) => void
  onToggle: (next: boolean) => void
}) {
  const enabled = flag?.enabled ?? false
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.experimentKey}>{experiment.key}</Text>
          <Text style={styles.cardTitle}>{experiment.title}</Text>
        </View>
        {experiment.flagColumn ? (
          <View style={styles.toggleWrap}>
            <Text style={[styles.toggleLabel, enabled && styles.toggleLabelOn]}>
              {enabled ? 'On' : 'Off'}
            </Text>
            <Switch
              value={enabled}
              onValueChange={onToggle}
              disabled={saving || flag == null}
              trackColor={{ true: ADMIN_ACCENT_GOLD, false: '#3a3a3c' }}
              accessibilityLabel={`${experiment.key} enabled`}
            />
          </View>
        ) : (
          <Text
            style={[
              styles.alwaysOn,
              experiment.running === false && styles.heldLabel,
            ]}
          >
            {experiment.running === false ? 'Held' : 'Live'}
          </Text>
        )}
      </View>

      {flag?.updatedAt ? (
        <Text style={styles.flagMeta}>Saved {new Date(flag.updatedAt).toLocaleDateString()}</Text>
      ) : null}

      <Text style={styles.sectionLabel}>Threshold</Text>
      <Text style={styles.thresholdLine}>
        Metric · {experiment.metric}
      </Text>
      <Text style={styles.thresholdLine}>Keep · {experiment.keep}</Text>
      <Text style={styles.thresholdKill}>Kill · {experiment.kill}</Text>
      <Text style={styles.thresholdLine}>Call · {experiment.callAfter}</Text>

      <Text style={styles.sectionLabel}>Results</Text>
      <View style={styles.timeFilter}>
        {(
          [
            { key: '7d' as const, label: '7d' },
            { key: '30d' as const, label: '30d' },
            { key: 'all' as const, label: 'All' },
          ] as const
        ).map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => onRange(key)}
            style={[styles.tfBtn, range === key && styles.tfBtnActive]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: range === key }}
          >
            <Text style={[styles.tfBtnText, range === key && styles.tfBtnTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.rangeMeta}>
        {formatRangeLabel(results)} · {results.totalUniqueUsers} users
      </Text>
      {results.truncated ? (
        <Text style={styles.warnText}>Result window truncated at the fetch cap.</Text>
      ) : null}

      {results.arms.map((arm) => (
        <View key={arm.arm} style={styles.armStats}>
          <Text style={styles.armStatsTitle}>{arm.label}</Text>
          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.uniqueUsers}</Text>
              <Text style={styles.metricLabel}>Users</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.lessonsCompleted}</Text>
              <Text style={styles.metricLabel}>Lessons</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.paywallViewed}</Text>
              <Text style={styles.metricLabel}>Paywall</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.premiumPurchased}</Text>
              <Text style={styles.metricLabel}>Premium</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

export default function AdminExperimentsScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [range, setRange] = useState<ExperimentDateRange>('30d')
  const [flags, setFlags] = useState<Record<string, FlagState>>({})
  const [resultsByKey, setResultsByKey] = useState<Record<string, ExperimentResults>>({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const errs: string[] = []
    const nextFlags: Record<string, FlagState> = {}
    const nextResults: Record<string, ExperimentResults> = {}

    await Promise.all(
      KNOWN_EXPERIMENTS.map(async (experiment) => {
        const [flagRes, resultsRes] = await Promise.all([
          experiment.flagColumn
            ? fetchExperimentFlag(supabase, experiment.flagColumn)
            : Promise.resolve({ enabled: true, updatedAt: null, error: null as string | null }),
          fetchExperimentResults(supabase, experiment, range),
        ])
        if (flagRes.error) errs.push(`${experiment.key} flag: ${flagRes.error}`)
        nextFlags[experiment.key] = {
          enabled: flagRes.enabled,
          updatedAt: flagRes.updatedAt,
        }
        if (resultsRes.error) errs.push(`${experiment.key} results: ${resultsRes.error}`)
        nextResults[experiment.key] = resultsRes.data
      }),
    )

    setFlags(nextFlags)
    setResultsByKey(nextResults)
    setError(errs.join('\n'))
  }, [range])

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
      title: 'Experiments',
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

  const onToggle = useCallback((experiment: KnownExperiment, next: boolean) => {
    if (!experiment.flagColumn) return
    const verb = next ? 'Turn on' : 'Turn off'
    Alert.alert(
      `${verb} ${experiment.key}?`,
      next
        ? 'New learners on a current build split 50/50. Older builds stay on control.'
        : 'New assignments stay on control.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: next ? 'default' : 'destructive',
          onPress: () => {
            void (async () => {
              setSavingKey(experiment.key)
              const { error: err } = await upsertExperimentFlag(
                supabase,
                experiment.flagColumn,
                next,
              )
              setSavingKey(null)
              if (err) {
                Alert.alert('Save failed', err)
                return
              }
              const flagRes = await fetchExperimentFlag(supabase, experiment.flagColumn)
              setFlags((prev) => ({
                ...prev,
                [experiment.key]: {
                  enabled: flagRes.enabled,
                  updatedAt: flagRes.updatedAt,
                },
              }))
            })()
          },
        },
      ],
    )
  }, [])

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
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ADMIN_ACCENT_GOLD} />
      }
    >
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {KNOWN_EXPERIMENTS.map((experiment) => (
        <ExperimentCard
          key={experiment.key}
          experiment={experiment}
          flag={flags[experiment.key] ?? null}
          results={resultsByKey[experiment.key] ?? emptyResults(experiment, range)}
          range={range}
          saving={savingKey === experiment.key}
          onRange={setRange}
          onToggle={(next) => onToggle(experiment, next)}
        />
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN_BG },
  content: { padding: 16, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: SCREEN_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: { color: '#f87171', marginBottom: 12, fontSize: 14 },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  cardHeaderText: { flex: 1, minWidth: 0 },
  experimentKey: {
    color: ADMIN_ACCENT_GOLD,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  cardTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700', marginTop: 2 },
  toggleWrap: { alignItems: 'flex-end', gap: 4 },
  toggleLabel: { color: '#8e8e93', fontSize: 12, fontWeight: '700' },
  toggleLabelOn: { color: ADMIN_ACCENT_GOLD },
  alwaysOn: { color: ADMIN_ACCENT_GOLD, fontSize: 12, fontWeight: '700', marginTop: 4 },
  heldLabel: { color: '#8e8e93' },
  flagMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  thresholdLine: { color: '#d1d5db', fontSize: 13, lineHeight: 18, marginTop: 4 },
  thresholdKill: { color: '#fca5a5', fontSize: 13, lineHeight: 18, marginTop: 4 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#666666',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
  },
  timeFilter: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 2,
    marginBottom: 10,
  },
  tfBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    borderRadius: 6,
  },
  tfBtnActive: { backgroundColor: '#3a3a3c' },
  tfBtnText: { fontSize: 11, color: '#888888', fontWeight: '500' },
  tfBtnTextActive: { color: '#fff', fontWeight: '600' },
  rangeMeta: { color: '#6b7280', fontSize: 12, lineHeight: 16, marginBottom: 2 },
  warnText: { color: '#fbbf24', fontSize: 12, marginTop: 6 },
  armStats: {
    marginTop: 12,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
  },
  armStatsTitle: { color: '#fff', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  metricRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  metric: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  metricValue: { color: '#fff', fontSize: 20, fontWeight: '700' },
  metricLabel: { color: '#888', fontSize: 11, marginTop: 2 },
})
