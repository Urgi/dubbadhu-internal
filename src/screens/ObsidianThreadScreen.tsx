import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { StackScreenProps } from '@react-navigation/stack'
import { AdminTextInput } from '../components/AdminTextInput'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import {
  OBSIDIAN_CREW_ROUTES,
  OBSIDIAN_ROLE_LABEL,
  applyRealtimeMessage,
  invokeObsidianChat,
  invokeObsidianHandoff,
  listObsidianMessages,
  subscribeObsidianMessages,
  unsubscribeObsidianMessages,
  type ObsidianCrewRoute,
  type ObsidianMessage,
  type ObsidianRole,
} from '../lib/obsidian'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'ObsidianThread'>

const ROLE_COLOR: Record<ObsidianRole, string> = {
  user: '#e5e7eb',
  chatgpt: '#93c5fd',
  ace: ADMIN_ACCENT_GOLD,
  moti: '#f9a8d4',
  jack: '#86efac',
  queen: '#c4b5fd',
  nigus: '#fdba74',
}

function crewLabel(route: ObsidianCrewRoute): string {
  return route[0].toUpperCase() + route.slice(1)
}

export default function ObsidianThreadScreen({ navigation, route }: Props) {
  const threadId = route.params.threadId
  const [title] = useState(route.params.title ?? 'Thread')
  const [messages, setMessages] = useState<ObsidianMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [crewRoute, setCrewRoute] = useState<ObsidianCrewRoute>('ace')
  const scrollRef = useRef<ScrollView>(null)

  const load = useCallback(async () => {
    const result = await listObsidianMessages(threadId)
    if (result.error) {
      setError(result.error)
      return
    }
    setError('')
    setMessages(result.data ?? [])
  }, [threadId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await load()
      if (!cancelled) setLoading(false)
    })()
    const channel = subscribeObsidianMessages(threadId, (message, event) => {
      setMessages((prev) => applyRealtimeMessage(prev, message, event))
    })
    return () => {
      cancelled = true
      unsubscribeObsidianMessages(channel)
    }
  }, [load, threadId])

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerStyle: { backgroundColor: '#000000' },
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: '#ffffff',
    })
  }, [navigation, title])

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [messages.length])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const aceWorking = useMemo(
    () => messages.some((row) => row.status === 'pending'),
    [messages],
  )

  const sendChat = useCallback(async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    setDraft('')
    const result = await invokeObsidianChat({ threadId, content })
    setSending(false)
    if (!result.ok) {
      setDraft(content)
      setError(result.error)
      return
    }
    setMessages((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]))
      for (const row of result.messages) byId.set(row.id, row)
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [draft, sending, threadId])

  const sendHandoff = useCallback(async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    setDraft('')
    const result = await invokeObsidianHandoff({ threadId, content, route: crewRoute })
    setSending(false)
    if (!result.ok) {
      setDraft(content)
      setError(result.error)
      return
    }
    setMessages((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]))
      for (const row of result.messages) byId.set(row.id, row)
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [crewRoute, draft, sending, threadId])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={ADMIN_ACCENT_GOLD} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={ADMIN_ACCENT_GOLD} />
        }
      >
        {messages.length === 0 ? (
          <Text style={styles.empty}>No messages yet. Ask ChatGPT or hand work to Ace.</Text>
        ) : (
          messages.map((row) => (
            <View
              key={row.id}
              style={[styles.bubble, row.role === 'user' ? styles.bubbleUser : styles.bubbleOther]}
            >
              <Text style={[styles.roleLabel, { color: ROLE_COLOR[row.role] }]}>
                {OBSIDIAN_ROLE_LABEL[row.role]}
                {row.status && row.status !== 'done' ? ` · ${row.status}` : ''}
              </Text>
              <Text style={styles.bubbleText}>{row.content}</Text>
            </View>
          ))
        )}
        {aceWorking ? <Text style={styles.working}>Ace working…</Text> : null}
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.composer}>
        <Text style={styles.routeHint}>Hand-to route</Text>
        <View style={styles.routeRow}>
          {OBSIDIAN_CREW_ROUTES.map((routeName) => (
            <Pressable
              key={routeName}
              onPress={() => setCrewRoute(routeName)}
              style={[styles.routeChip, crewRoute === routeName && styles.routeChipOn]}
            >
              <Text style={[styles.routeChipText, crewRoute === routeName && styles.routeChipTextOn]}>
                {crewLabel(routeName)}
              </Text>
            </Pressable>
          ))}
        </View>
        <AdminTextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message…"
          placeholderTextColor="#6b7280"
          allowMultiline
          editable={!sending}
        />
        <View style={styles.sendRow}>
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              styles.sendChat,
              pressed && styles.pressed,
              (sending || !draft.trim()) && styles.disabled,
            ]}
            disabled={sending || !draft.trim()}
            onPress={() => {
              void sendChat()
            }}
          >
            <Text style={styles.sendChatText}>{sending ? 'Sending…' : 'Ask ChatGPT'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              styles.sendAce,
              pressed && styles.pressed,
              (sending || !draft.trim()) && styles.disabled,
            ]}
            disabled={sending || !draft.trim()}
            onPress={() => {
              void sendHandoff()
            }}
          >
            <Text style={styles.sendAceText}>{sending ? 'Sending…' : `Hand to ${crewLabel(crewRoute)}`}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  centered: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcript: { flex: 1 },
  transcriptContent: { padding: 16, paddingBottom: 12, gap: 10 },
  empty: { color: '#6b7280', fontSize: 14 },
  working: {
    color: ADMIN_ACCENT_GOLD,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  bubble: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    gap: 4,
  },
  bubbleUser: {
    backgroundColor: '#1f2937',
    borderColor: '#374151',
    alignSelf: 'flex-end',
    maxWidth: '92%',
  },
  bubbleOther: {
    backgroundColor: '#111827',
    borderColor: '#1f2937',
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  roleLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  bubbleText: {
    color: '#f3f4f6',
    fontSize: 15,
    lineHeight: 21,
  },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    padding: 12,
    paddingBottom: 16,
    gap: 8,
    backgroundColor: '#0a0a0a',
  },
  routeHint: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  routeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  routeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  routeChipOn: {
    backgroundColor: '#1f2937',
    borderColor: ADMIN_ACCENT_GOLD,
  },
  routeChipText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  routeChipTextOn: {
    color: ADMIN_ACCENT_GOLD,
  },
  input: {
    minHeight: 72,
    maxHeight: 140,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  sendRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sendBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sendChat: {
    backgroundColor: '#1d4ed8',
  },
  sendAce: {
    backgroundColor: ADMIN_ACCENT_GOLD,
  },
  sendChatText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sendAceText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.45 },
})
