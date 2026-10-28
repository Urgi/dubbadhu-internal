import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import CrewAvatar from '../components/crew/CrewAvatar'
import {
  isCrewUnread,
  isMacAwake,
  listCrewBots,
  macLastSeen,
  readCrewCache,
  subscribeCrew,
  type CrewBot,
} from '../lib/crew'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'ObsidianTeam'>

const UNREAD = '#3b82f6'
const AMBER = '#c9a37c'

function formatWhen(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatAgo(ms: number): string {
  if (!ms) return 'a while ago'
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 60) return `${Math.max(1, min)} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ObsidianTeamScreen({ navigation }: Props) {
  const [bots, setBots] = useState<CrewBot[]>([])
  const [lastRead, setLastRead] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    const result = await listCrewBots()
    setBots(result.data)
    setError(result.error ? `Showing saved chats. ${result.error}` : '')
    setLastRead({ ...(await readCrewCache()).lastRead })
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        // Saved copy first, so the list opens instantly and without a connection.
        const cache = await readCrewCache()
        if (!cancelled && cache.bots.length) {
          setBots(cache.bots)
          setLastRead({ ...cache.lastRead })
          setLoading(false)
        }
        await load()
        if (!cancelled) setLoading(false)
      })()
      const unsubscribe = subscribeCrew((table, row) => {
        if (table !== 'crew_bots') return
        const bot = row as unknown as CrewBot
        setBots((rows) => {
          const next = rows.some((r) => r.id === bot.id)
            ? rows.map((r) => (r.id === bot.id ? bot : r))
            : [...rows, bot]
          return next.sort((a, b) => a.sort - b.sort)
        })
      })
      return () => {
        cancelled = true
        unsubscribe()
      }
    }, [load]),
  )

  // Re-check "Mac is asleep" every half minute.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Obsidian Team',
      headerStyle: { backgroundColor: '#0b0b0b' },
      headerShadowVisible: false,
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: '#ffffff',
      headerBackTitle: '',
    })
  }, [navigation])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const open = useCallback(
    (bot: CrewBot) => navigation.navigate('CrewChat', { botId: bot.id, name: bot.name }),
    [navigation],
  )

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  const awake = isMacAwake(bots)

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}
    >
      {bots.length && !awake ? (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>Your Mac is asleep</Text>
          <Text style={styles.bannerText}>
            Last seen {formatAgo(macLastSeen(bots))}. You can still read every chat and send messages. They run
            when your Mac wakes up.
          </Text>
        </View>
      ) : null}
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      {!bots.length ? (
        <Text style={styles.empty}>
          No crew yet. Open Claude Crew on your Mac once, and its chats will show up here.
        </Text>
      ) : null}

      <View style={styles.grid}>
        {bots.map((bot) => (
          <Pressable
            key={bot.id}
            style={({ pressed }) => [styles.gridItem, pressed && styles.pressed]}
            onPress={() => open(bot)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${bot.name}`}
          >
            <View>
              <CrewAvatar color={bot.color} shape={bot.shape} size={58} />
              {isCrewUnread(bot, lastRead) || bot.waiting ? <View style={styles.gridDot} /> : null}
            </View>
            <Text style={styles.gridName} numberOfLines={1}>
              {bot.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {bots.map((bot) => {
        const unread = isCrewUnread(bot, lastRead)
        const preview = bot.waiting
          ? 'Needs your approval'
          : bot.busy
            ? 'typing…'
            : `${bot.last_role === 'user' ? 'You: ' : ''}${(bot.last_text ?? '').replace(/\s+/g, ' ')}`
        return (
          <Pressable
            key={`row-${bot.id}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => open(bot)}
          >
            <CrewAvatar color={bot.color} shape={bot.shape} size={44} />
            <View style={styles.rowMeta}>
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {bot.name}
                </Text>
                <Text style={styles.rowWhen}>{formatWhen(bot.last_at)}</Text>
              </View>
              <Text
                style={[styles.rowPreview, (bot.waiting > 0 || bot.busy) && styles.rowPreviewHot]}
                numberOfLines={2}
              >
                {preview || 'No messages yet'}
              </Text>
            </View>
            {unread || bot.waiting ? <View style={styles.dot} /> : null}
          </Pressable>
        )
      })}

      <Pressable
        style={({ pressed }) => [styles.oldRow, pressed && styles.pressed]}
        onPress={() => navigation.navigate('Obsidian')}
      >
        <Text style={styles.oldTitle}>Old threads</Text>
        <Text style={styles.oldMeta}>Obsidian desk history</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0b0b' },
  content: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0b' },
  pressed: { backgroundColor: '#171717' },
  banner: {
    backgroundColor: '#1a1510',
    borderColor: '#3a2c1c',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  bannerTitle: { color: '#f6e7d6', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  bannerText: { color: '#cdb9a3', fontSize: 13, lineHeight: 18 },
  errorBanner: { color: '#fca5a5', fontSize: 12, marginBottom: 10, paddingHorizontal: 4 },
  empty: { color: '#9a9a9a', fontSize: 14, lineHeight: 20, padding: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  gridItem: { width: '25%', alignItems: 'center', paddingVertical: 10, borderRadius: 16 },
  gridDot: {
    position: 'absolute',
    right: 0,
    top: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: UNREAD,
    borderWidth: 2,
    borderColor: '#0b0b0b',
  },
  gridName: { color: '#d4d4d4', fontSize: 12, marginTop: 6, maxWidth: 80 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowTitle: { flex: 1, color: '#f2f2f2', fontSize: 15, fontWeight: '600' },
  rowWhen: { color: '#6b6b6b', fontSize: 12 },
  rowPreview: { color: '#9a9a9a', fontSize: 13, lineHeight: 18, marginTop: 2 },
  rowPreviewHot: { color: AMBER },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: UNREAD },
  oldRow: {
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#262626',
  },
  oldTitle: { color: '#d4d4d4', fontSize: 15, fontWeight: '600' },
  oldMeta: { color: '#6b6b6b', fontSize: 12, marginTop: 2 },
})
