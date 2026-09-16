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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
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
  const [crewRoute, setCrewRoute] = useState<ObsidianCrewRoute | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  const insets = useSafeAreaInsets()

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

  const pendingRow = useMemo(
    () => messages.find((row) => row.status === 'pending') ?? null,
    [messages],
  )

  const mergeIncoming = useCallback((incoming: ObsidianMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((row) => [row.id, row]))
      for (const row of incoming) byId.set(row.id, row)
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [])

  const send = useCallback(async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    setDraft('')
    const result = crewRoute
      ? await invokeObsidianHandoff({ threadId, content, route: crewRoute })
      : await invokeObsidianChat({ threadId, content })
    setSending(false)
    if (!result.ok) {
      setDraft(content)
      setError(result.error)
      return
    }
    mergeIncoming(result.messages)
  }, [crewRoute, draft, mergeIncoming, sending, threadId])

  const talkingTo = crewRoute ? crewLabel(crewRoute) : 'Obsidian'
  const canSend = Boolean(draft.trim()) && !sending

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
          <Text style={styles.empty}>No messages yet. Talk to Obsidian, or pick someone to message directly.</Text>
        ) : (
          messages.map((row) => (
            <View
              key={row.id}
              style={[styles.bubble, row.role === 'user' ? styles.bubbleUser : styles.bubbleOther]}
            >
              <Text style={[styles.roleLabel, { color: ROLE_COLOR[row.role] }]}>
                {row.role === 'chatgpt' ? 'Obsidian' : OBSIDIAN_ROLE_LABEL[row.role]}
                {row.status && row.status !== 'done' ? ` · ${row.status}` : ''}
              </Text>
              <Text style={styles.bubbleText}>{row.content}</Text>
            </View>
          ))
        )}
        {pendingRow ? (
          <Text style={styles.working}>
            {pendingRow.role === 'chatgpt' ? 'Obsidian' : OBSIDIAN_ROLE_LABEL[pendingRow.role]} working…
          </Text>
        ) : null}
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(8, Math.min(insets.bottom, 12)) }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.routeRow}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => setCrewRoute(null)}
            style={[styles.routeChip, crewRoute === null && styles.routeChipOn]}
          >
            <Text style={[styles.routeChipText, crewRoute === null && styles.routeChipTextOn]}>Obsidian</Text>
          </Pressable>
          {OBSIDIAN_CREW_ROUTES.map((routeName) => (
            <Pressable
              key={routeName}
              onPress={() => setCrewRoute((current) => (current === routeName ? null : routeName))}
              style={[styles.routeChip, crewRoute === routeName && styles.routeChipOn]}
            >
              <Text style={[styles.routeChipText, crewRoute === routeName && styles.routeChipTextOn]}>
                {crewLabel(routeName)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.inputBar}>
          <AdminTextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${talkingTo}…`}
            placeholderTextColor="#6b7280"
            allowMultiline
            editable={!sending}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              pressed && styles.pressed,
              !canSend && styles.sendBtnOff,
            ]}
            disabled={!canSend}
            onPress={() => {
              void send()
            }}
            accessibilityRole="button"
            accessibilityLabel={`Send to ${talkingTo}`}
          >
            <Text style={[styles.sendGlyph, !canSend && styles.sendGlyphOff]}>{sending ? '…' : '↑'}</Text>
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
  transcriptContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  empty: { color: '#6b7280', fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  working: {
    color: ADMIN_ACCENT_GOLD,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    gap: 2,
  },
  bubbleUser: {
    backgroundColor: '#1c1c1e',
    alignSelf: 'flex-end',
    maxWidth: '86%',
  },
  bubbleOther: {
    backgroundColor: '#121212',
    alignSelf: 'flex-start',
    maxWidth: '86%',
  },
  roleLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bubbleText: {
    color: '#f3f4f6',
    fontSize: 15,
    lineHeight: 20,
  },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
  },
  composer: {
    paddingHorizontal: 10,
    paddingTop: 6,
    gap: 6,
    backgroundColor: '#000000',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 8,
  },
  routeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'transparent',
  },
  routeChipOn: {
    backgroundColor: 'rgba(212, 164, 55, 0.12)',
    borderColor: ADMIN_ACCENT_GOLD,
  },
  routeChipText: {
    color: '#8b8b8b',
    fontSize: 12,
    fontWeight: '600',
  },
  routeChipTextOn: {
    color: ADMIN_ACCENT_GOLD,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#161616',
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 3,
  },
  input: {
    flex: 1,
    minHeight: 28,
    maxHeight: 100,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: '#ffffff',
    paddingHorizontal: 0,
    paddingVertical: 6,
    fontSize: 15,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnOff: {
    backgroundColor: '#2a2a2a',
  },
  sendGlyph: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '800',
    marginTop: -1,
  },
  sendGlyphOff: {
    color: '#6b7280',
  },
  pressed: { opacity: 0.88 },
})
