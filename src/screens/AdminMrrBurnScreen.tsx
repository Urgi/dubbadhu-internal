import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { AdminTextInput } from '../components/AdminTextInput'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import {
  defaultMrrBurnState,
  formatUsd,
  isCustomCostLine,
  lineTotal,
  netAfterStoreCut,
  newCustomCostLine,
  sliceGrossMrr,
  sumCosts,
  sumGrossMrr,
  sumSubCount,
  type CostLine,
  type MrrBurnState,
  type RevenueSlice,
} from '../lib/mrrBurn'
import { loadMrrBurnState, saveMrrBurnState } from '../lib/mrrBurnStorage'
import {
  fetchRevenueCatOverview,
  findMetric,
  type DurationCount,
  type RevenueCatOverview,
} from '../lib/revenueCatMetrics'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminMrrBurn'>

const SCREEN_BG = '#0a0a0a'
const CARD_BG = '#1c1c1e'

function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function QtyField({
  label,
  value,
  onChange,
  width = 72,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  width?: number
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <AdminTextInput
        style={[styles.numInput, { width }]}
        value={String(value)}
        onChangeText={(t) => onChange(parseNum(t))}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
    </View>
  )
}

function durationLine(rows: DurationCount[]): string {
  return rows.length ? rows.map((r) => `${r.count} ${r.label.toLowerCase()}`).join(' · ') : 'none'
}

function RevenueCatCard() {
  const [overview, setOverview] = useState<RevenueCatOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await fetchRevenueCatOverview()
    setOverview(res.data)
    setError(res.error ?? '')
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const mrr = overview ? findMetric(overview, 'mrr') : null
  const subs = overview ? findMetric(overview, 'active_subscriptions') : null
  const trials = overview ? findMetric(overview, 'active_trials') : null
  const revenue = overview ? findMetric(overview, 'revenue') : null
  const updatedAt = mrr?.updatedAt ? new Date(mrr.updatedAt.replace(' ', 'T')) : null

  return (
    <View style={styles.rcCard}>
      <View style={styles.rcHeader}>
        <Text style={styles.heroLabel}>RevenueCat · live</Text>
        <Pressable
          onPress={() => void load()}
          disabled={loading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Refresh RevenueCat numbers"
        >
          <Text style={styles.rcRefresh}>{loading ? 'Loading…' : 'Refresh'}</Text>
        </Pressable>
      </View>
      {loading && !overview ? (
        <ActivityIndicator color={ADMIN_ACCENT_GOLD} style={styles.rcSpinner} />
      ) : error ? (
        <Text style={styles.rcError}>{error}</Text>
      ) : overview ? (
        <>
          <Text style={styles.rcValue}>{mrr ? formatUsd(mrr.value) : '—'}</Text>
          <Text style={styles.heroSub}>
            MRR{overview.currency !== 'USD' ? ` (${overview.currency})` : ''}
            {revenue ? ` · ${formatUsd(revenue.value, 0)} revenue last 28 days` : ''}
          </Text>
          <View style={styles.rcStats}>
            <View style={styles.rcStat}>
              <Text style={styles.rcStatValue}>{subs ? Math.round(subs.value) : '—'}</Text>
              <Text style={styles.fieldLabel}>Paying subs</Text>
              {overview.byDuration ? (
                <Text style={styles.rowNote}>{durationLine(overview.byDuration.subscriptions)}</Text>
              ) : null}
            </View>
            <View style={styles.rcStat}>
              <Text style={styles.rcStatValue}>{trials ? Math.round(trials.value) : '—'}</Text>
              <Text style={styles.fieldLabel}>Trials</Text>
              {overview.byDuration ? (
                <Text style={styles.rowNote}>{durationLine(overview.byDuration.trials)}</Text>
              ) : null}
            </View>
          </View>
          {overview.breakdownError ? (
            <Text style={styles.rowNote}>Monthly / annual split unavailable: {overview.breakdownError}</Text>
          ) : null}
          {updatedAt && !Number.isNaN(updatedAt.getTime()) ? (
            <Text style={styles.rowNote}>Updated {updatedAt.toLocaleString()}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

export default function AdminMrrBurnScreen({ navigation }: Props) {
  const [state, setState] = useState<MrrBurnState>(() => defaultMrrBurnState())
  const [loading, setLoading] = useState(true)
  const [savedHint, setSavedHint] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback((next: MrrBurnState) => {
    setState(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveMrrBurnState(next).then(() => {
        setSavedHint('Saved on this device')
      })
    }, 350)
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        setLoading(true)
        const loaded = await loadMrrBurnState()
        if (!cancelled) {
          setState(loaded)
          setLoading(false)
        }
      })()
      return () => {
        cancelled = true
        if (saveTimer.current) clearTimeout(saveTimer.current)
      }
    }, []),
  )

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'MRR & burn',
      headerStyle: { backgroundColor: '#000000' },
      headerTintColor: '#f4f4f5',
      headerTitleStyle: { color: '#f4f4f5', fontWeight: '600' },
    })
  }, [navigation])

  const grossMrr = useMemo(() => sumGrossMrr(state.revenue), [state.revenue])
  const subCount = useMemo(() => sumSubCount(state.revenue), [state.revenue])
  const netMrr = useMemo(
    () => netAfterStoreCut(grossMrr, state.storeCutRate),
    [grossMrr, state.storeCutRate],
  )
  const burn = useMemo(() => sumCosts(state.costs), [state.costs])
  const runway = netMrr - burn

  const updateRevenue = (id: RevenueSlice['id'], patch: Partial<RevenueSlice>) => {
    persist({
      ...state,
      revenue: state.revenue.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })
  }

  const updateCost = (id: string, patch: Partial<CostLine>) => {
    persist({
      ...state,
      costs: state.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  const addCustomCost = () => {
    persist({ ...state, costs: [...state.costs, newCustomCostLine()] })
    setSavedHint('Added expense')
  }

  const removeCost = (id: string) => {
    persist({ ...state, costs: state.costs.filter((c) => c.id !== id) })
    setSavedHint('Removed expense')
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={ADMIN_ACCENT_GOLD} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={styles.lede}>
        Gross MRR is subscribers × list price. Monthly is $9.99 even if someone subscribed at
        $7.99. Annual is the yearly price spread over 12 months. The store cut (15% by default)
        comes off that gross. Costs are per-unit — edit seats and environments from real invoices.
        Numbers save on this device only.
      </Text>
      {savedHint ? <Text style={styles.savedHint}>{savedHint}</Text> : null}

      <RevenueCatCard />

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Net after store cut − burn</Text>
        <Text style={[styles.heroValue, runway < 0 ? styles.neg : styles.pos]}>
          {formatUsd(runway)}
        </Text>
        <Text style={styles.heroSub}>
          {formatUsd(netMrr)} net MRR · {formatUsd(burn)} burn · {subCount} paying
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Revenue</Text>
      <View style={styles.card}>
        {state.revenue.map((slice) => {
          const gross = sliceGrossMrr(slice)
          const perMonth = slice.id === 'annual' ? slice.unitPrice / 12 : slice.unitPrice
          return (
            <View key={slice.id} style={styles.revRow}>
              <View style={styles.revLeft}>
                <Text style={styles.rowTitle}>{slice.label}</Text>
                <Text style={styles.rowNote}>
                  {formatUsd(perMonth)} / sub / mo · {formatUsd(gross)} gross
                </Text>
              </View>
              <QtyField
                label="Subs"
                value={slice.count}
                onChange={(n) => updateRevenue(slice.id, { count: Math.max(0, Math.round(n)) })}
                width={56}
              />
              <QtyField
                label={slice.id === 'annual' ? '$ / yr' : '$ / mo'}
                value={slice.unitPrice}
                onChange={(n) => updateRevenue(slice.id, { unitPrice: Math.max(0, n) })}
                width={72}
              />
            </View>
          )
        })}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Gross MRR</Text>
          <Text style={styles.totalValue}>{formatUsd(grossMrr)}</Text>
        </View>
        <View style={styles.cutRow}>
          <Text style={styles.cutLabel}>
            Store cut ({Math.round(state.storeCutRate * 100)}%)
          </Text>
          <QtyField
            label="Rate"
            value={Math.round(state.storeCutRate * 100)}
            onChange={(n) =>
              persist({
                ...state,
                storeCutRate: Math.min(100, Math.max(0, n)) / 100,
              })
            }
            width={56}
          />
          <Text style={styles.totalValue}>{formatUsd(netMrr)} net</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Monthly burn</Text>
      {state.costs.map((line) => {
        const total = lineTotal(line)
        const custom = isCustomCostLine(line)
        return (
          <View
            key={line.id}
            style={[styles.card, styles.costCard, !line.enabled && styles.costCardOff]}
          >
            <View style={styles.costHeader}>
              <View style={styles.costHeaderText}>
                {custom ? (
                  <AdminTextInput
                    style={styles.nameInput}
                    value={line.label}
                    onChangeText={(t) => updateCost(line.id, { label: t })}
                    placeholder="Expense name"
                    placeholderTextColor="#52525b"
                  />
                ) : (
                  <Text style={styles.rowTitle}>{line.label}</Text>
                )}
                {line.note && !custom ? <Text style={styles.rowNote}>{line.note}</Text> : null}
              </View>
              <Switch
                value={line.enabled}
                onValueChange={(on) => updateCost(line.id, { enabled: on })}
                trackColor={{ true: ADMIN_ACCENT_GOLD, false: '#3a3a3c' }}
              />
            </View>
            <View style={styles.costInputs}>
              <QtyField
                label={`$/ ${line.unitLabel}`}
                value={line.unitPrice}
                onChange={(n) => updateCost(line.id, { unitPrice: Math.max(0, n) })}
                width={80}
              />
              <QtyField
                label="Qty"
                value={line.qty}
                onChange={(n) => updateCost(line.id, { qty: Math.max(0, n) })}
                width={56}
              />
              <View style={styles.lineTotalWrap}>
                <Text style={styles.fieldLabel}>Line</Text>
                <Text style={styles.lineTotal}>{formatUsd(total)}</Text>
              </View>
            </View>
            {custom ? (
              <Pressable
                onPress={() => removeCost(line.id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${line.label}`}
              >
                <Text style={styles.removeCostText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        )
      })}

      <Pressable
        style={styles.addCostBtn}
        onPress={addCustomCost}
        accessibilityRole="button"
        accessibilityLabel="Add expense"
      >
        <Text style={styles.addCostBtnText}>+ Add expense</Text>
        <Text style={styles.addCostBtnSub}>Custom monthly cost — name, $/unit, qty</Text>
      </Pressable>

      <View style={styles.card}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total burn</Text>
          <Text style={styles.totalValue}>{formatUsd(burn)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Contribution</Text>
          <Text style={[styles.totalValue, runway < 0 ? styles.neg : styles.pos]}>
            {formatUsd(runway)}
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.resetBtn}
        onPress={() => {
          const next = defaultMrrBurnState()
          persist(next)
          setSavedHint('Reset to Oct 2026 defaults')
        }}
      >
        <Text style={styles.resetBtnText}>Reset to defaults</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SCREEN_BG },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 48, gap: 10 },
  lede: { color: '#a1a1aa', fontSize: 13, lineHeight: 19, marginBottom: 4 },
  savedHint: { color: ADMIN_ACCENT_GOLD, fontSize: 12, marginBottom: 4 },
  heroCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(232,135,10,0.35)',
    marginBottom: 8,
  },
  rcCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 18,
    gap: 6,
  },
  rcHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rcRefresh: { color: ADMIN_ACCENT_GOLD, fontSize: 13, fontWeight: '600' },
  rcSpinner: { marginVertical: 12 },
  rcError: { color: '#f87171', fontSize: 13, lineHeight: 18 },
  rcValue: { color: '#fafafa', fontSize: 32, fontWeight: '700' },
  rcStats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  rcStat: { flex: 1, backgroundColor: '#111113', borderRadius: 10, padding: 12, gap: 2 },
  rcStatValue: { color: '#fafafa', fontSize: 22, fontWeight: '700' },
  heroLabel: { color: '#a1a1aa', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  heroValue: { color: '#fafafa', fontSize: 36, fontWeight: '700', marginTop: 6 },
  heroSub: { color: '#a1a1aa', fontSize: 13, marginTop: 8 },
  sectionTitle: {
    color: ADMIN_ACCENT_GOLD,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 2,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  costCard: { marginBottom: 2 },
  costCardOff: { opacity: 0.45 },
  revRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  revLeft: { flex: 1, paddingBottom: 4 },
  rowTitle: { color: '#f4f4f5', fontSize: 15, fontWeight: '600' },
  rowNote: { color: '#71717a', fontSize: 12, marginTop: 3, lineHeight: 16 },
  field: { gap: 4 },
  fieldLabel: { color: '#71717a', fontSize: 11 },
  numInput: {
    backgroundColor: '#111113',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    color: '#fafafa',
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3f3f46',
  },
  totalLabel: { color: '#d4d4d8', fontSize: 14, fontWeight: '600' },
  totalValue: { color: '#fafafa', fontSize: 16, fontWeight: '700' },
  cutRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  cutLabel: { flex: 1, color: '#a1a1aa', fontSize: 13, paddingBottom: 8 },
  costHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  costHeaderText: { flex: 1 },
  nameInput: {
    backgroundColor: '#111113',
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    color: '#fafafa',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  costInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  lineTotalWrap: { flex: 1, alignItems: 'flex-end', gap: 4, paddingBottom: 6 },
  lineTotal: { color: '#fafafa', fontSize: 16, fontWeight: '700' },
  removeCostText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  addCostBtn: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderStyle: 'dashed',
  },
  addCostBtnText: { color: ADMIN_ACCENT_GOLD, fontSize: 15, fontWeight: '700' },
  addCostBtnSub: { color: '#71717a', fontSize: 12, marginTop: 4 },
  pos: { color: '#5ECF6E' },
  neg: { color: '#f87171' },
  resetBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  resetBtnText: { color: '#71717a', fontSize: 13 },
})
