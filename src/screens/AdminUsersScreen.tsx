import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useLayoutEffect, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import {
  adminUsersModeLead,
  adminUsersModeTitle,
  fetchAnalyticsCohortUsers,
  type AdminCohortUserRow,
  type AdminUsersListMode,
} from '../lib/adminAnalyticsCohorts'
import { registeredUserDisplayName, userRowToTimelineParams } from '../lib/adminUsers'
import { platformLabel, type AdminDevicePlatform } from '../lib/adminDevicePlatform'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminUsers'>

const GOLD = ADMIN_ACCENT_GOLD
const CARD_BG = '#141414'
const HAIRLINE = '#2a2a2a'

function formatLastLogin(value: string | null | undefined): string {
  if (!value) return '—'
  const trimmed = String(value).slice(0, 10)
  const [y, m, d] = trimmed.split('-')
  if (!y || !m || !d) return trimmed
  return `${m}/${d}/${y}`
}

function formatLastEventAt(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function PlatformBadge({
  platform,
  appVersion,
}: {
  platform?: AdminDevicePlatform | null
  appVersion?: string | null
}) {
  const label = platformLabel(platform)
  if (label === '—') {
    return (
      <View style={[styles.badge, styles.badgeMuted]}>
        <Text style={styles.badgeTextMuted}>OS ?</Text>
      </View>
    )
  }
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>
        {label}
        {appVersion ? ` · ${appVersion}` : ''}
      </Text>
    </View>
  )
}

function UserRow({
  row,
  showLastEvent,
  onPress,
}: {
  row: AdminCohortUserRow
  showLastEvent: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open timeline for ${registeredUserDisplayName(row)}`}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowMain}>
          <Text style={styles.name} numberOfLines={1}>
            {registeredUserDisplayName(row)}
          </Text>
          {row.phone ? (
            <Text style={styles.phone} numberOfLines={1}>
              {row.phone}
            </Text>
          ) : null}
        </View>
        <PlatformBadge platform={row.platform} appVersion={row.app_version} />
      </View>
      {row.qualify_note ? (
        <Text
          style={[
            styles.qualify,
            /^(No push|Not premium)$/i.test(row.qualify_note) ? styles.qualifyMuted : null,
          ]}
        >
          {row.qualify_note}
        </Text>
      ) : null}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{row.current_streak ?? 0}</Text>
          <Text style={styles.statLabel}>Streak</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{row.longest_streak ?? 0}</Text>
          <Text style={styles.statLabel}>Top</Text>
        </View>
        <View style={[styles.stat, styles.statWide]}>
          <Text style={styles.statValue} numberOfLines={1}>
            {showLastEvent
              ? formatLastEventAt(row.last_event_at)
              : formatLastLogin(row.last_activity_date)}
          </Text>
          <Text style={styles.statLabel}>{showLastEvent ? 'Last active' : 'Last login'}</Text>
        </View>
      </View>
    </Pressable>
  )
}

function resolveMode(raw: string | undefined): AdminUsersListMode {
  if (
    raw === 'activeToday' ||
    raw === 'activeNow' ||
    raw === 'notifications' ||
    raw === 'activated' ||
    raw === 'premium'
  ) {
    return raw
  }
  return 'registered'
}

export default function AdminUsersScreen({ navigation, route }: Props) {
  const mode = resolveMode(route.params?.mode)
  const showLastEvent = mode === 'activeToday' || mode === 'activeNow'
  const countryScope =
    mode === 'premium'
      ? 'non_et'
      : route.params?.countryScope === 'et' || route.params?.countryScope === 'non_et'
        ? route.params.countryScope
        : 'all'
  const scopeLabel =
    mode === 'premium'
      ? 'Non-Ethiopia (always)'
      : countryScope === 'et'
        ? 'Ethiopia (+251)'
        : countryScope === 'non_et'
          ? 'Non-Ethiopia'
          : null

  const [rows, setRows] = useState<AdminCohortUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadList = useCallback(async () => {
    setError('')
    const result = await fetchAnalyticsCohortUsers(mode, countryScope)
    if (result.error) {
      setError(result.error)
      setRows([])
    } else {
      setRows(result.data ?? [])
    }
  }, [mode, countryScope])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        setLoading(true)
        await loadList()
        if (!cancelled) setLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }, [loadList]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadList()
    setRefreshing(false)
  }, [loadList])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: adminUsersModeTitle(mode),
      headerStyle: { backgroundColor: '#000000' },
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: GOLD,
    })
  }, [navigation, mode])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />}
    >
      <Text style={styles.lead}>{adminUsersModeLead(mode, scopeLabel)}</Text>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      <Text style={styles.count}>{rows.length} shown</Text>
      {rows.length === 0 && !error ? (
        <Text style={styles.empty}>No users match this section.</Text>
      ) : (
        rows.map((row) => (
          <UserRow
            key={row.id}
            row={row}
            showLastEvent={showLastEvent}
            onPress={() =>
              navigation.navigate('AdminUserTimeline', { user: userRowToTimelineParams(row) })
            }
          />
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  lead: {
    color: '#8e8e93',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 2,
  },
  count: {
    color: '#636366',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
  },
  empty: { color: '#636366', fontSize: 14, marginTop: 12 },
  row: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 14,
    gap: 10,
  },
  rowPressed: { opacity: 0.88 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowMain: { flex: 1, gap: 2, minWidth: 0 },
  name: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  phone: { color: '#8e8e93', fontSize: 12 },
  qualify: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '600',
  },
  qualifyMuted: {
    color: '#636366',
  },
  badge: {
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeMuted: {
    backgroundColor: '#1c1c1e',
    borderColor: HAIRLINE,
  },
  badgeText: { color: GOLD, fontSize: 11, fontWeight: '700' },
  badgeTextMuted: { color: '#636366', fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: '#0b0b0b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  statWide: { flex: 1.45 },
  statValue: { color: GOLD, fontSize: 13, fontWeight: '700' },
  statLabel: {
    color: '#636366',
    fontSize: 9,
    marginTop: 2,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
