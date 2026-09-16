import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { useHeaderHeight } from '@react-navigation/elements'
import { AdminTextInput } from '../components/AdminTextInput'
import ObsidianActivitySummary from '../components/obsidian/ObsidianActivitySummary'
import ObsidianDelegateSheet from '../components/obsidian/ObsidianDelegateSheet'
import ObsidianJobCard from '../components/obsidian/ObsidianJobCard'
import ObsidianMarkdown from '../components/obsidian/ObsidianMarkdown'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import {
  applyRealtimeMessage,
  invokeObsidianChat,
  invokeObsidianHandoff,
  listObsidianMessages,
  OBSIDIAN_ROLE_LABEL,
  subscribeObsidianMessages,
  unsubscribeObsidianMessages,
  updateObsidianMessageContent,
  updateObsidianThreadTitle,
  type ObsidianCrewRoute,
  type ObsidianMessage,
} from '../lib/obsidian'
import { crewDisplayName, isCrewRouteName, OBSIDIAN_CREW } from '../lib/obsidianCrew'
import {
  dateKey,
  formatClock,
  formatDayLabel,
  looksLikeDataQuestion,
  parseObsidianJob,
  serializeObsidianJob,
  type ObsidianJobPayload,
} from '../lib/obsidianJob'
import { parseActivitySummary } from '../lib/obsidianActivity'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'ObsidianThread'>

function isJobCard(row: ObsidianMessage): boolean {
  if (parseObsidianJob(row.content)) return true
  return isCrewRouteName(row.role) && row.status !== null
}

export default function ObsidianThreadScreen({ navigation, route }: Props) {
  const threadId = route.params.threadId
  const [threadTitle, setThreadTitle] = useState(route.params.title ?? 'New thread')
  const [messages, setMessages] = useState<ObsidianMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [delegateTarget, setDelegateTarget] = useState<ObsidianCrewRoute | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ messageId: string; job: ObsidianJobPayload } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const scrollRef = useRef<ScrollView>(null)
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()

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

  const pendingRow = useMemo(
    () => messages.find((row) => row.status === 'pending') ?? null,
    [messages],
  )

  const subtitle = useMemo(() => {
    if (pendingRow && isCrewRouteName(pendingRow.role)) {
      return `${crewDisplayName(pendingRow.role)} is working…`
    }
    if (pendingRow?.role === 'chatgpt' || sending) {
      const lastUser = [...messages].reverse().find((row) => row.role === 'user')
      if (looksLikeDataQuestion(lastUser?.content ?? draft)) return 'Reviewing Dubbadhu data…'
      return 'Thinking…'
    }
    return 'Dubbadhu thinking desk'
  }, [draft, messages, pendingRow, sending])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Obsidian',
      headerBackTitle: 'Back',
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: '#000000' },
      headerTintColor: '#ffffff',
      headerTitle: () => (
        <View style={{ alignItems: 'center', maxWidth: 220 }}>
          <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>Obsidian</Text>
          <Text style={{ color: '#8b8b8b', fontSize: 12, textAlign: 'center', marginTop: 1 }} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ),
    })
  }, [navigation, subtitle])

  const skipAutoScroll = useRef(true)
  useEffect(() => {
    if (skipAutoScroll.current) {
      skipAutoScroll.current = false
      return
    }
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    }, 50)
    return () => clearTimeout(timer)
  }, [messages.length, sending])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

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
    const target = delegateTarget
    const result = target
      ? await invokeObsidianChat({ threadId, content, draftJob: true, route: target })
      : await invokeObsidianChat({ threadId, content })
    setSending(false)
    if (!result.ok) {
      setDraft(content)
      setError(result.error)
      return
    }
    setDelegateTarget(null)
    mergeIncoming(result.messages)
  }, [delegateTarget, draft, mergeIncoming, sending, threadId])

  const assignJob = useCallback(
    async (message: ObsidianMessage, job: ObsidianJobPayload) => {
      if (assigningId) return
      setAssigningId(message.id)
      setError('')
      const result = await invokeObsidianHandoff({
        threadId,
        content: job.objective,
        route: job.assignedAgentId,
        goal: job.objective,
        deliverable: job.deliverable,
        context: job.contextSummary,
        urgency: job.priority,
        draftMessageId: message.id,
        assignOnly: true,
      })
      setAssigningId(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      mergeIncoming(result.messages)
    },
    [assigningId, mergeIncoming, threadId],
  )

  const saveEdit = useCallback(async () => {
    if (!editing) return
    const result = await updateObsidianMessageContent(editing.messageId, serializeObsidianJob(editing.job))
    if (result.error || !result.data) {
      setError(result.error || 'Could not save job.')
      return
    }
    mergeIncoming([result.data])
    setEditing(null)
  }, [editing, mergeIncoming])

  const canSend = Boolean(draft.trim()) && !sending
  const placeholder = delegateTarget
    ? `Creating a job for ${crewDisplayName(delegateTarget)}…`
    : 'Think, draft, or assign work…'

  const transcript = useMemo(() => {
    const items: Array<{ type: 'day'; key: string; label: string } | { type: 'msg'; key: string; row: ObsidianMessage }> =
      []
    let lastDay = ''
    for (const row of messages) {
      const day = dateKey(row.created_at)
      if (day !== lastDay) {
        lastDay = day
        items.push({ type: 'day', key: `day-${day}`, label: formatDayLabel(row.created_at) })
      }
      items.push({ type: 'msg', key: row.id, row })
    }
    return items
  }, [messages])

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
      keyboardVerticalOffset={headerHeight}
    >
      <Pressable
        onPress={() => {
          setRenameDraft(threadTitle)
          setRenameOpen(true)
        }}
        style={styles.threadBar}
      >
        <Text style={styles.threadBarLabel}>Thread</Text>
        <Text style={styles.threadBarTitle} numberOfLines={1}>
          {threadTitle || 'New thread'}
        </Text>
      </Pressable>

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
          <Text style={styles.empty}>
            Think with Obsidian in this thread. Delegate when you want Ace or the crew to execute.
          </Text>
        ) : (
          transcript.map((item) => {
            if (item.type === 'day') {
              return (
                <Text key={item.key} style={styles.day}>
                  {item.label}
                </Text>
              )
            }
            const row = item.row
            if (isJobCard(row)) {
              return (
                <ObsidianJobCard
                  key={row.id}
                  message={row}
                  assigningId={assigningId}
                  expanded={Boolean(expandedIds[row.id])}
                  onToggleExpand={() =>
                    setExpandedIds((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                  }
                  onAssign={(job) => {
                    void assignJob(row, job)
                  }}
                  onEdit={(job) => setEditing({ messageId: row.id, job })}
                  onChangeAgent={(job) => {
                    setEditing({ messageId: row.id, job })
                    setDelegateOpen(true)
                  }}
                  onAskObsidian={(job) => {
                    setDelegateTarget(null)
                    setDraft(`Talk through this result from ${crewDisplayName(job.assignedAgentId)}:\n${job.summary || job.objective}`)
                  }}
                  onRevise={(job) => {
                    setDelegateTarget(job.assignedAgentId)
                    setDraft(`Revise this job: ${job.objective}`)
                  }}
                />
              )
            }
            const time = formatClock(row.created_at)
            if (row.role === 'user') {
              return (
                <View key={row.id} style={styles.userWrap}>
                  <View style={styles.userBubble}>
                    <Text style={styles.userText}>{row.content}</Text>
                  </View>
                </View>
              )
            }

            const activity = row.role === 'chatgpt' ? parseActivitySummary(row.content) : null
            const hideReadyNote = /^Ready to hand this to /i.test(row.content)

            return (
              <View key={row.id} style={styles.assistantBlock}>
                <View style={styles.assistantMeta}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarGlyph}>O</Text>
                  </View>
                  <Text style={styles.assistantName}>{OBSIDIAN_ROLE_LABEL[row.role]}</Text>
                  {time ? <Text style={styles.assistantTime}>· {time}</Text> : null}
                </View>
                {activity ? (
                  <ObsidianActivitySummary
                    summary={activity}
                    onViewTimeline={() => navigation.navigate('AdminUsers')}
                    onMonitor={() => setDraft(`Monitor ${activity.title}. Tell me if they start Lesson 1.`)}
                    onFollowUp={() => setDraft('What should I watch next for this user?')}
                  />
                ) : hideReadyNote ? (
                  <Text style={styles.readyNote}>{row.content}</Text>
                ) : row.role === 'chatgpt' ? (
                  <ObsidianMarkdown text={row.content} />
                ) : (
                  <Text style={styles.assistantPlain}>{row.content}</Text>
                )}
                {row.role === 'chatgpt' && !activity && !hideReadyNote ? (
                  <View style={styles.msgActions}>
                    {looksLikeDataQuestion(row.content) ? (
                      <Pressable style={styles.chipAction} onPress={() => navigation.navigate('AdminAnalytics')}>
                        <Text style={styles.chipActionText}>View activity</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={styles.chipAction}
                        onPress={() => setDraft(`Explore further:\n${row.content.slice(0, 280)}`)}
                      >
                        <Text style={styles.chipActionText}>Explore further</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={styles.chipAction}
                      onPress={() => setDraft('Ask a follow-up on the last answer.')}
                    >
                      <Text style={styles.chipActionText}>Ask follow-up</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            )
          })
        )}
        {sending && !pendingRow ? <Text style={styles.working}>Thinking…</Text> : null}
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {delegateTarget ? (
          <View style={styles.delegateChipRow}>
            <View style={[styles.delegateChip, { borderColor: OBSIDIAN_CREW[delegateTarget].color }]}>
              <Text style={[styles.delegateChipText, { color: OBSIDIAN_CREW[delegateTarget].color }]}>
                Job for {crewDisplayName(delegateTarget)}
              </Text>
              <Pressable onPress={() => setDelegateTarget(null)} accessibilityLabel="Remove agent">
                <Text style={styles.delegateChipX}>×</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={styles.inputBar}>
          <Pressable
            style={({ pressed }) => [styles.delegateIconBtn, pressed && styles.pressed]}
            onPress={() => setDelegateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Delegate"
          >
            <Text style={styles.delegateIcon}>↳</Text>
          </Pressable>
          <AdminTextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
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
            accessibilityLabel="Send to Obsidian"
          >
            {sending ? (
              <ActivityIndicator size="small" color="#111111" />
            ) : (
              <Text style={[styles.sendGlyph, !canSend && styles.sendGlyphOff]}>↑</Text>
            )}
          </Pressable>
        </View>
      </View>

      <ObsidianDelegateSheet
        visible={delegateOpen}
        onClose={() => setDelegateOpen(false)}
        onPick={(route) => {
          if (editing) {
            setEditing({
              ...editing,
              job: { ...editing.job, assignedAgentId: route },
            })
            return
          }
          setDelegateTarget(route)
        }}
      />

      <Modal visible={Boolean(editing) && !delegateOpen} transparent animationType="fade">
        <Pressable style={styles.editBackdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.editTitle}>Edit job</Text>
            <Text style={styles.editLabel}>Objective</Text>
            <AdminTextInput
              allowMultiline
              style={styles.editInput}
              value={editing?.job.objective ?? ''}
              onChangeText={(text) =>
                setEditing((prev) => (prev ? { ...prev, job: { ...prev.job, objective: text } } : prev))
              }
            />
            <Text style={styles.editLabel}>Deliverable</Text>
            <AdminTextInput
              allowMultiline
              style={styles.editInput}
              value={editing?.job.deliverable ?? ''}
              onChangeText={(text) =>
                setEditing((prev) => (prev ? { ...prev, job: { ...prev.job, deliverable: text } } : prev))
              }
            />
            <Text style={styles.editLabel}>Context</Text>
            <AdminTextInput
              allowMultiline
              style={styles.editInput}
              value={editing?.job.contextSummary ?? ''}
              onChangeText={(text) =>
                setEditing((prev) => (prev ? { ...prev, job: { ...prev.job, contextSummary: text } } : prev))
              }
            />
            <View style={styles.editActions}>
              <Pressable onPress={() => setEditing(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.saveBtn}
                onPress={() => {
                  void saveEdit()
                }}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <Pressable style={styles.editBackdrop} onPress={() => setRenameOpen(false)}>
          <Pressable style={styles.editSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.editTitle}>Thread title</Text>
            <AdminTextInput
              style={styles.editInput}
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="Name this thread"
              placeholderTextColor="#6b7280"
            />
            <View style={styles.editActions}>
              <Pressable onPress={() => setRenameOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.saveBtn}
                onPress={() => {
                  void (async () => {
                    const result = await updateObsidianThreadTitle(threadId, renameDraft)
                    if (result.error) {
                      setError(result.error)
                      return
                    }
                    setThreadTitle(renameDraft.trim())
                    setRenameOpen(false)
                  })()
                }}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  threadBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f1f1f',
  },
  threadBarLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  threadBarTitle: { color: '#d4d4d8', fontSize: 17, fontWeight: '600', marginTop: 2 },
  transcript: { flex: 1 },
  transcriptContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  empty: { color: '#6b7280', fontSize: 15, lineHeight: 22 },
  day: {
    alignSelf: 'center',
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
    marginVertical: 10,
  },
  working: {
    color: ADMIN_ACCENT_GOLD,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  userWrap: {
    alignItems: 'flex-end',
    marginBottom: 18,
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  userText: {
    color: '#fafafa',
    fontSize: 16,
    lineHeight: 22,
  },
  assistantBlock: {
    alignSelf: 'stretch',
    marginBottom: 18,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(147, 197, 253, 0.45)',
  },
  assistantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1e3a5f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { color: '#93c5fd', fontSize: 10, fontWeight: '800' },
  assistantName: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  assistantTime: { color: '#737373', fontSize: 12 },
  assistantPlain: { color: '#e8e8ea', fontSize: 16, lineHeight: 23 },
  readyNote: { color: '#a1a1aa', fontSize: 15, lineHeight: 21 },
  msgActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chipAction: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActionText: { color: '#f4f4f5', fontSize: 14, fontWeight: '600' },
  errorBanner: {
    color: '#fca5a5',
    backgroundColor: '#450a0a',
    borderRadius: 8,
    padding: 8,
    fontSize: 13,
    marginTop: 8,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
    backgroundColor: '#000000',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f1f1f',
  },
  delegateChipRow: { flexDirection: 'row' },
  delegateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  delegateChipText: { fontSize: 13, fontWeight: '600' },
  delegateChipX: { color: '#9ca3af', fontSize: 16, fontWeight: '700' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#161616',
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 8,
    gap: 8,
  },
  delegateIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delegateIcon: {
    color: '#a1a1aa',
    fontSize: 18,
    fontWeight: '700',
    marginTop: -1,
  },
  input: {
    flex: 1,
    minHeight: 22,
    maxHeight: 100,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: '#ffffff',
    paddingHorizontal: 0,
    paddingVertical: 4,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
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
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  editSheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 8,
  },
  editTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  editLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '700' },
  editInput: {
    minHeight: 48,
    maxHeight: 90,
    color: '#ffffff',
    backgroundColor: '#1c1c1e',
    borderRadius: 10,
    padding: 8,
  },
  editActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#9ca3af', fontSize: 15 },
  saveBtn: {
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveText: { color: '#111111', fontWeight: '700' },
})
