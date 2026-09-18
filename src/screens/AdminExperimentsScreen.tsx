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
  formatArmRate,
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
  const end = new Date(results.untilIso)
  if (!results.sinceIso) {
    return `All time through ${end.toLocaleString()}`
  }
  return `${new Date(results.sinceIso).toLocaleString()} → ${end.toLocaleString()}`
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
      </View>

      <Text style={styles.flagMeta}>
        Flag: app_config.{experiment.flagColumn}
      </Text>
      {flag?.updatedAt ? (
        <Text style={styles.flagMeta}>Last saved: {new Date(flag.updatedAt).toLocaleString()}</Text>
      ) : null}

      <Text style={styles.binaryNote}>{experiment.requiresLearnerBinaryNote}</Text>

      <Text style={styles.sectionLabel}>Hypothesis</Text>
      <Text style={styles.body}>{experiment.hypothesis}</Text>
      <Text style={styles.sectionLabel}>Guardrail</Text>
      <Text style={styles.body}>{experiment.guardrail}</Text>

      <Text style={styles.sectionLabel}>Arms</Text>
      {experiment.arms.map((arm) => (
        <Text key={arm.id} style={styles.armLine}>
          {arm.id}
          {'\n'}
          {arm.label}
        </Text>
      ))}

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
      <Text style={styles.rangeMeta}>{formatRangeLabel(results)}</Text>
      <Text style={styles.rangeMeta}>
        Exposures from {results.exposureEventName} · {results.totalExposures} events ·{' '}
        {results.totalUniqueUsers} unique users
      </Text>
      {results.truncated ? (
        <Text style={styles.warnText}>Result window truncated at the fetch cap.</Text>
      ) : null}

      {results.totalUniqueUsers === 0 ? (
        <Text style={styles.muted}>
          No {results.exposureEventName} rows for this key in range. Turn the flag on after a
          learner binary that emits exposures is live.
        </Text>
      ) : null}

      {results.arms.map((arm) => (
        <View key={arm.arm} style={styles.armStats}>
          <Text style={styles.armStatsTitle}>{arm.arm}</Text>
          <Text style={styles.armStatsLabel}>{arm.label}</Text>
          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.exposures}</Text>
              <Text style={styles.metricLabel}>Exposures</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{arm.uniqueUsers}</Text>
              <Text style={styles.metricLabel}>Users</Text>
            </View>
          </View>
          {results.sawActivationEvent ? (
            <Text style={styles.funnelLine}>
              activation_complete · {formatArmRate(arm, 'activation')}
            </Text>
          ) : (
            <Text style={styles.funnelMuted}>activation_complete · no events in range</Text>
          )}
          {results.sawPaywallEvent ? (
            <Text style={styles.funnelLine}>
              paywall_viewed · {formatArmRate(arm, 'paywall')}
            </Text>
          ) : (
            <Text style={styles.funnelMuted}>paywall_viewed · no events in range</Text>
          )}
          {results.sawPremiumEvent ? (
            <Text style={styles.funnelLine}>
              premium_purchased · {formatArmRate(arm, 'premium')}
            </Text>
          ) : (
            <Text style={styles.funnelMuted}>premium_purchased · no events in range</Text>
          )}
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
          fetchExperimentFlag(supabase, experiment.flagColumn),
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
    const verb = next ? 'Turn on' : 'Turn off'
    Alert.alert(
      `${verb} ${experiment.key}?`,
      next
        ? 'Learners on a binary that reads this flag will be assigned 50/50. Older binaries ignore it.'
        : 'New assignments stay on control_l1_free. This writes only the experiment flag on app_config.',
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
      <Text style={styles.hint}>
        Known learner A/B tests. Toggle writes one app_config column via service role. Results use
        analytics_events (exclude_from_analytics users dropped when joinable).
      </Text>
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
  hint: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 12 },
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
  flagMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  binaryNote: {
    color: '#fbbf24',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#666666',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 6,
  },
  body: { color: '#d1d5db', fontSize: 13, lineHeight: 18 },
  armLine: { color: '#9ca3af', fontSize: 12, lineHeight: 17, marginBottom: 6 },
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
  muted: { color: '#71717a', fontSize: 13, lineHeight: 18, marginTop: 8 },
  armStats: {
    marginTop: 12,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
  },
  armStatsTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  armStatsLabel: { color: '#8e8e93', fontSize: 12, marginTop: 2, marginBottom: 8 },
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
  funnelLine: { color: '#d1d5db', fontSize: 12, lineHeight: 18, marginTop: 2 },
  funnelMuted: { color: '#6b7280', fontSize: 12, lineHeight: 18, marginTop: 2 },
})
