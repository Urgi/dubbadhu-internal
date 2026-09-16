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
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import { createObsidianThread, listObsidianThreads, type ObsidianThread } from '../lib/obsidian'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'Obsidian'>

function formatWhen(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 16)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function ObsidianScreen({ navigation }: Props) {
  const [threads, setThreads] = useState<ObsidianThread[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const result = await listObsidianThreads()
    if (result.error) {
      setError(result.error)
      setThreads([])
    } else {
      setThreads(result.data ?? [])
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
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
      title: 'Obsidian',
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

  const onNewThread = useCallback(async () => {
    if (creating) return
    setCreating(true)
    setError('')
    const result = await createObsidianThread()
    setCreating(false)
    if (result.error || !result.data) {
      setError(result.error || 'Could not create thread.')
      return
    }
    navigation.navigate('ObsidianThread', { threadId: result.data.id, title: result.data.title })
  }, [creating, navigation])

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
      <Text style={styles.lead}>
        Thinking desk. Talk to Obsidian by default — it can query product SQL. Pick a teammate only when you want to message them directly.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.newBtn, pressed && styles.pressed, creating && styles.disabled]}
        onPress={() => {
          void onNewThread()
        }}
        disabled={creating}
      >
        <Text style={styles.newBtnText}>{creating ? 'Creating…' : 'New thread'}</Text>
      </Pressable>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      {threads.length === 0 && !error ? (
        <Text style={styles.empty}>No threads yet. Start one and send a message.</Text>
      ) : (
        threads.map((thread) => (
          <Pressable
            key={thread.id}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('ObsidianThread', { threadId: thread.id, title: thread.title })
            }
          >
            <Text style={styles.rowTitle} numberOfLines={2}>
              {thread.title || 'New thread'}
            </Text>
            <Text style={styles.rowMeta}>{formatWhen(thread.updated_at)}</Text>
          </Pressable>
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
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lead: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  newBtn: {
    backgroundColor: ADMIN_ACCENT_GOLD,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newBtnText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  empty: { color: '#6b7280', fontSize: 14, marginTop: 8 },
  row: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    gap: 4,
  },
  rowTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  rowMeta: {
    color: '#6b7280',
    fontSize: 12,
  },
})
