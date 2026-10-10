import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { registeredUserDisplayName } from '../lib/adminUsers'
import {
  fetchDeviceInfoForUserIds,
  platformLabel,
  readAppVersionFromProperties,
  readPlatformFromProperties,
  type AdminDeviceInfo,
  type AdminDevicePlatform,
} from '../lib/adminDevicePlatform'
import {
  fetchUserAnalyticsEvents,
  type AnalyticsEventRow,
} from '../lib/analyticsEventsQuery'
import { formatAnalyticsEventDetail } from '../lib/analyticsHealthEvents'
import { fetchLessonDisplayLabels, uniqueLessonIds } from '../lib/lessonEventLabels'
import {
  fetchSignupTimelineForUser,
  type RecentSignupTimeline,
} from '../lib/recentSignupTimelines'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminUserTimeline'>

const RECENT_EVENT_LIMIT = 20
const GOLD = ADMIN_ACCENT_GOLD
const CARD_BG = '#141414'
const HAIRLINE = '#2a2a2a'

function formatEventWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 19)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function PlatformChip({
  platform,
  appVersion,
}: {
  platform: AdminDevicePlatform | null | undefined
  appVersion?: string | null
}) {
  const label = platformLabel(platform)
  if (label === '—') {
    return (
      <View style={[styles.chip, styles.chipMuted]}>
        <Text style={styles.chipTextMuted}>OS unknown</Text>
      </View>
    )
  }
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>
        {label}
        {appVersion ? ` · ${appVersion}` : ''}
      </Text>
    </View>
  )
}

export default function AdminUserTimelineScreen({ navigation, route }: Props) {
  const user = route.params.user
  const [timeline, setTimeline] = useState<RecentSignupTimeline | null>(null)
  const [recentEvents, setRecentEvents] = useState<AnalyticsEventRow[]>([])
  const [lessonLabels, setLessonLabels] = useState<Record<string, string>>({})
  const [device, setDevice] = useState<AdminDeviceInfo | null>(
    user.platform
      ? { platform: user.platform, appVersion: user.app_version ?? null }
      : null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [eventsError, setEventsError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setEventsError('')
    const [timelineRes, eventsRes, deviceMap] = await Promise.all([
      fetchSignupTimelineForUser(supabase, user),
      fetchUserAnalyticsEvents(supabase, user.id, RECENT_EVENT_LIMIT),
      fetchDeviceInfoForUserIds(supabase, [user.id]),
    ])

    if (timelineRes.error && !timelineRes.data) {
      setError(timelineRes.error)
      setTimeline(null)
    } else {
      if (timelineRes.error) setError(timelineRes.error)
      setTimeline(timelineRes.data)
    }

    const fromMap = deviceMap.get(user.id)
    if (fromMap) setDevice(fromMap)

    if (eventsRes.error) {
      setEventsError(eventsRes.error)
      setRecentEvents([])
      setLessonLabels({})
    } else {
      setRecentEvents(eventsRes.data)
      setLessonLabels(await fetchLessonDisplayLabels(supabase, uniqueLessonIds(eventsRes.data)))
      if (!fromMap || fromMap.platform === 'unknown' || !fromMap.appVersion) {
        for (const ev of eventsRes.data) {
          const p = readPlatformFromProperties(ev.properties)
          const v = readAppVersionFromProperties(ev.properties)
          if (p !== 'unknown' || v) {
            setDevice((prev) => ({
              platform:
                prev?.platform && prev.platform !== 'unknown'
                  ? prev.platform
                  : p !== 'unknown'
                    ? p
                    : 'unknown',
              appVersion: prev?.appVersion ?? v,
            }))
            break
          }
        }
      }
    }
  }, [user])

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
      title: registeredUserDisplayName(user),
      headerStyle: { backgroundColor: '#000000' },
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: GOLD,
    })
  }, [navigation, user])

  const headerMeta = useMemo(() => {
    const parts = [timeline?.title?.split('·')[1]?.trim()].filter(Boolean)
    return parts.join(' · ')
  }, [timeline])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.cardTopText}>
            <Text style={styles.title}>{registeredUserDisplayName(user)}</Text>
            {user.phone ? <Text style={styles.phone}>{user.phone}</Text> : null}
            {headerMeta ? <Text style={styles.region}>{headerMeta}</Text> : null}
          </View>
          <PlatformChip platform={device?.platform} appVersion={device?.appVersion} />
        </View>
        {timeline ? (
          <>
            <Text style={styles.summary}>{timeline.lessonSummary}</Text>
            {timeline.steps.map((step, si) => (
              <View key={`${timeline.userId}-${si}-${step.label}`} style={styles.step}>
                <View style={styles.dotCol}>
                  <View style={styles.dot} />
                  {si < timeline.steps.length - 1 ? <View style={styles.line} /> : null}
                </View>
                <View style={styles.stepBody}>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                  {step.detail ? <Text style={styles.stepDetail}>{step.detail}</Text> : null}
                </View>
              </View>
            ))}
          </>
        ) : (
          <Text style={styles.emptyInline}>No lesson timeline available.</Text>
        )}
      </View>

      <Text style={styles.sectionLabel}>Recent events</Text>
      <View style={styles.card}>
        {eventsError ? (
          <Text style={styles.inlineError}>{eventsError}</Text>
        ) : recentEvents.length === 0 ? (
          <Text style={styles.emptyInline}>No analytics events for this user yet.</Text>
        ) : (
          recentEvents.map((row, i) => {
            const eventPlatform = readPlatformFromProperties(row.properties)
            const eventVersion = readAppVersionFromProperties(row.properties)
            return (
              <View
                key={row.id || `${row.created_at}-${row.event_name}-${i}`}
                style={[styles.eventRow, i === recentEvents.length - 1 && styles.eventRowLast]}
              >
                <View style={styles.eventHead}>
                  <Text style={styles.eventMeta}>{formatEventWhen(row.created_at)}</Text>
                  {eventPlatform !== 'unknown' ? (
                    <Text style={styles.eventOs}>
                      {platformLabel(eventPlatform)}
                      {eventVersion ? ` ${eventVersion}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.eventName}>{row.event_name}</Text>
                <Text style={styles.eventDetail} numberOfLines={3}>
                  {formatAnalyticsEventDetail(row.event_name, row.properties, lessonLabels)}
                </Text>
              </View>
            )
          })
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 16, paddingBottom: 40 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    marginBottom: 12,
  },
  emptyInline: { color: '#636366', fontSize: 13 },
  inlineError: { color: '#fca5a5', fontSize: 13 },
  sectionLabel: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  cardTopText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  phone: { fontSize: 12, color: '#8e8e93' },
  region: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  chip: {
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipMuted: { backgroundColor: '#1c1c1e', borderColor: HAIRLINE },
  chipText: { color: GOLD, fontSize: 11, fontWeight: '700' },
  chipTextMuted: { color: '#636366', fontSize: 11, fontWeight: '600' },
  summary: { fontSize: 13, color: GOLD, fontWeight: '600', marginBottom: 14 },
  step: { flexDirection: 'row', alignItems: 'stretch', minHeight: 28 },
  dotCol: { width: 14, alignItems: 'center', paddingTop: 5 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: HAIRLINE,
    marginTop: 2,
  },
  stepBody: { flex: 1, paddingBottom: 12, paddingLeft: 8 },
  stepLabel: { fontSize: 14, color: '#e5e7eb', fontWeight: '500' },
  stepDetail: { fontSize: 12, color: '#8e8e93', marginTop: 2 },
  eventRow: {
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  eventRowLast: { borderBottomWidth: 0 },
  eventHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  eventMeta: { color: '#636366', fontSize: 11, fontWeight: '500' },
  eventOs: { color: GOLD, fontSize: 11, fontWeight: '700' },
  eventName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  eventDetail: { color: '#8e8e93', fontSize: 12, marginTop: 3, lineHeight: 16 },
})
