import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import type { StackScreenProps } from '@react-navigation/stack'
import CrewAvatar from '../components/crew/CrewAvatar'
import ObsidianMarkdown from '../components/obsidian/ObsidianMarkdown'
import { ADMIN_EMAIL, sendAdminOtp, verifyAdminOtp } from '../lib/adminAuth'
import {
  CREW_ACTION_STATUS_LABEL,
  decideCrewAction,
  isMacAwake,
  listCrewBots,
  loadCrewChat,
  markCrewRead,
  readCrewCache,
  sendCrewMessage,
  subscribeCrew,
  type CrewAction,
  type CrewBot,
  type CrewMessage,
} from '../lib/crew'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'CrewChat'>

const BG = '#0b0b0b'
const BUBBLE = '#1a1a1a'
const BUBBLE_LINE = '#2a2a2a'
const USER = '#8b5a2b'
const USER_TEXT = '#f6e7d6'
const MUTED = '#9a9a9a'
const AMBER = '#c9a37c'

type Pending = { action: CrewAction; decision: 'approve' | 'deny'; confirm: boolean }

function ActionCard({
  action,
  busy,
  onDecide,
}: {
  action: CrewAction
  busy: boolean
  onDecide: (decision: 'approve' | 'deny', confirm: boolean) => void
}) {
  const hot = /prod|github|expo|eas/i.test(action.environment ?? '')
  const open = action.status === 'pending' || action.status === 'confirm'
  const p = action.preview ?? {}
  const clip = (s: string) => (s.length > 1500 ? `${s.slice(0, 1500)}\n…` : s)
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {action.title}
        </Text>
        {action.environment ? (
          <Text style={[styles.env, hot && styles.envHot]}>{action.environment}</Text>
        ) : null}
      </View>
      {action.danger ? (
        <Text style={styles.danger}>⚠ {action.danger}. This needs two approvals.</Text>
      ) : null}
      {action.reason ? <Text style={styles.reason}>{action.reason}</Text> : null}
      {action.command ? <Text style={styles.mono}>{action.command}</Text> : null}
      {action.target ? (
        <Text style={styles.target}>
          {action.command ? 'in ' : ''}
          {action.target.replace(/^\/Users\/[^/]+/, '~')}
        </Text>
      ) : null}
      {p.sql ? <Text style={styles.mono}>{clip(p.sql)}</Text> : null}
      {(p.edits ?? []).map((e, i) => (
        <Text key={i} style={styles.mono}>
          {clip(
            [
              ...(e.old ?? '').split('\n').map((l) => `- ${l}`),
              ...(e.new ?? '').split('\n').map((l) => `+ ${l}`),
            ].join('\n'),
          )}
        </Text>
      ))}
      {p.new != null ? <Text style={styles.mono}>{clip(p.new)}</Text> : null}
      {action.output && !open ? <Text style={styles.output}>{clip(action.output)}</Text> : null}
      <View style={styles.cardFoot}>
        <Text style={[styles.cardStatus, open && { color: AMBER }]}>{CREW_ACTION_STATUS_LABEL[action.status]}</Text>
        {open ? (
          busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <View style={styles.cardButtons}>
              <Pressable style={styles.denyBtn} onPress={() => onDecide('deny', false)}>
                <Text style={styles.denyText}>Deny</Text>
              </Pressable>
              <Pressable
                style={[styles.approveBtn, action.status === 'confirm' && styles.reallyBtn]}
                onPress={() => onDecide('approve', action.status === 'confirm')}
              >
                <Text style={styles.approveText}>
                  {action.status === 'confirm' ? 'Yes, really run it' : 'Approve'}
                </Text>
              </Pressable>
            </View>
          )
        ) : null}
      </View>
    </View>
  )
}

export default function CrewChatScreen({ navigation, route }: Props) {
  const { botId, name } = route.params
  const headerHeight = useHeaderHeight()
  const [bot, setBot] = useState<CrewBot | null>(null)
  const [macAwake, setMacAwake] = useState(true)
  const [messages, setMessages] = useState<CrewMessage[]>([])
  const [actions, setActions] = useState<Record<string, CrewAction>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<Pending | null>(null)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState('')
  const listRef = useRef<FlatList<CrewMessage>>(null)

  const applyBots = useCallback(
    (bots: CrewBot[]) => {
      setBot(bots.find((b) => b.id === botId) ?? null)
      setMacAwake(isMacAwake(bots))
    },
    [botId],
  )

  const load = useCallback(async () => {
    const [chat, bots] = await Promise.all([loadCrewChat(botId), listCrewBots()])
    setMessages(chat.data.messages)
    setActions(chat.data.actions)
    applyBots(bots.data)
    setError(chat.error ? `Showing saved chat. ${chat.error}` : '')
  }, [applyBots, botId])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void (async () => {
        const cache = await readCrewCache()
        const saved = cache.chats[botId]
        if (!cancelled && saved) {
          setMessages(saved.messages)
          setActions(saved.actions)
          applyBots(cache.bots)
          setLoading(false)
        }
        await load()
        if (!cancelled) setLoading(false)
      })()
      const unsubscribe = subscribeCrew((table, row) => {
        if (table === 'crew_messages') {
          const m = row as unknown as CrewMessage
          if (m.bot_id !== botId) return
          setMessages((rows) => {
            const i = rows.findIndex((r) => r.id === m.id)
            if (i < 0) return [...rows, m].sort((a, b) => a.created_at.localeCompare(b.created_at))
            const next = rows.slice()
            next[i] = m
            return next
          })
        } else if (table === 'crew_actions') {
          const a = row as unknown as CrewAction
          if (a.bot_id === botId) setActions((all) => ({ ...all, [a.id]: a }))
        } else if (table === 'crew_bots') {
          const b = row as unknown as CrewBot
          if (b.id === botId) {
            setBot(b)
            setMacAwake(isMacAwake([b]))
          }
        }
      }, botId)
      return () => {
        cancelled = true
        unsubscribe()
      }
    }, [applyBots, botId, load]),
  )

  // Seen up to the newest reply.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant')
    if (last) void markCrewRead(botId, last.created_at)
  }, [botId, messages])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: BG },
      headerShadowVisible: false,
      headerTintColor: '#ffffff',
      headerBackTitle: '',
      headerTitleAlign: 'center',
      headerTitle: () => (
        <View style={styles.titlePill}>
          {bot ? <CrewAvatar color={bot.color} shape={bot.shape} size={22} /> : null}
          <Text style={styles.titleText} numberOfLines={1}>
            {bot?.name ?? name}
          </Text>
        </View>
      ),
    })
  }, [bot, name, navigation])

  const onSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError('')
    const result = await sendCrewMessage(botId, text)
    setSending(false)
    if (result.error || !result.data) {
      setError(result.error || 'Could not send.')
      return
    }
    setDraft('')
    const sent = result.data
    setMessages((rows) => (rows.some((r) => r.id === sent.id) ? rows : [...rows, sent]))
  }, [botId, draft, sending])

  const decide = useCallback(async ({ action, decision, confirm }: Pending) => {
    setDeciding(action.id)
    setError('')
    const result = await decideCrewAction(action.id, decision, confirm)
    setDeciding(null)
    if (result.needsSignIn) {
      setSignIn({ action, decision, confirm })
      setCode('')
      setCodeSent(false)
      setSignInError('')
      return false
    }
    if (!result.ok) setError(result.error || 'Could not send your decision.')
    return result.ok
  }, [])

  const onSendCode = useCallback(async () => {
    setSignInBusy(true)
    setSignInError('')
    const res = await sendAdminOtp(ADMIN_EMAIL)
    setSignInBusy(false)
    if (res.ok) setCodeSent(true)
    else setSignInError(res.error || 'Could not send the code.')
  }, [])

  const onVerifyCode = useCallback(async () => {
    if (!signIn) return
    setSignInBusy(true)
    setSignInError('')
    const res = await verifyAdminOtp(code, ADMIN_EMAIL)
    setSignInBusy(false)
    if (!res.ok) {
      setSignInError(res.error || 'Invalid or expired code.')
      return
    }
    const pending = signIn
    setSignIn(null)
    await decide(pending)
  }, [code, decide, signIn])

  const data = useMemo(() => [...messages].reverse(), [messages])

  const renderItem = useCallback(
    ({ item }: { item: CrewMessage }) => {
      if (item.role === 'user') {
        const waitingForMac = item.status === 'queued'
        return (
          <View style={styles.userWrap}>
            {item.routine ? <Text style={styles.routineTag}>⏰ {item.routine}</Text> : null}
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{item.text}</Text>
            </View>
            {waitingForMac ? (
              <Text style={styles.queued}>{macAwake ? 'Sending to your Mac…' : 'Waiting for your Mac to wake up'}</Text>
            ) : null}
          </View>
        )
      }
      const cards = item.action_ids.map((id) => actions[id]).filter(Boolean)
      if (!item.text && !item.tools.length && !cards.length && !item.note) return null
      return (
        <View style={styles.botWrap}>
          {item.tools.length ? (
            <View style={styles.tools}>
              {item.tools.map((t, i) => (
                <Text key={i} style={styles.tool} numberOfLines={2}>
                  {t}
                </Text>
              ))}
            </View>
          ) : null}
          {item.text ? (
            <View style={styles.botBubble}>
              <ObsidianMarkdown text={item.text} />
            </View>
          ) : null}
          {cards.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              busy={deciding === a.id}
              onDecide={(decision, confirm) => void decide({ action: a, decision, confirm })}
            />
          ))}
          {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
        </View>
      )
    },
    [actions, decide, deciding, macAwake],
  )

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  const placeholder = bot?.busy
    ? 'Add to what it is doing…'
    : macAwake
      ? 'Message'
      : 'Message (runs when your Mac wakes)'

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      {!macAwake ? (
        <Text style={styles.asleep}>Your Mac is asleep. Messages wait and run when it wakes up.</Text>
      ) : null}
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          bot?.busy ? <Text style={styles.typing}>{bot.name} is working…</Text> : null
        }
        ListEmptyComponent={<Text style={styles.empty}>Say hi to {bot?.name ?? name}.</Text>}
        keyboardShouldPersistTaps="handled"
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor="#6b6b6b"
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
          onPress={() => void onSend()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          {sending ? <ActivityIndicator color="#000000" /> : <Text style={styles.sendText}>↑</Text>}
        </Pressable>
      </View>

      <Modal visible={!!signIn} transparent animationType="fade" onRequestClose={() => setSignIn(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sign in to approve</Text>
            <Text style={styles.modalText}>
              Approvals need a fresh code from {ADMIN_EMAIL}. You only do this once in a while.
            </Text>
            {codeSent ? (
              <TextInput
                style={styles.codeInput}
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor="#6b6b6b"
                keyboardType="number-pad"
                autoFocus
              />
            ) : null}
            {signInError ? <Text style={styles.modalError}>{signInError}</Text> : null}
            <View style={styles.modalButtons}>
              <Pressable style={styles.denyBtn} onPress={() => setSignIn(null)}>
                <Text style={styles.denyText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.approveBtn, signInBusy && styles.sendBtnOff]}
                disabled={signInBusy || (codeSent && code.trim().length < 6)}
                onPress={() => void (codeSent ? onVerifyCode() : onSendCode())}
              >
                <Text style={styles.approveText}>{codeSent ? 'Verify' : 'Send code'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  titlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1c1c1c',
    borderRadius: 18,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 14,
    maxWidth: 220,
  },
  titleText: { color: '#f2f2f2', fontSize: 15, fontWeight: '600' },
  asleep: {
    color: '#cdb9a3',
    backgroundColor: '#1a1510',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  errorBanner: { color: '#fca5a5', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  listContent: { paddingHorizontal: 14, paddingVertical: 12 },
  empty: { color: MUTED, textAlign: 'center', marginTop: 40, transform: [{ scaleY: -1 }] },
  typing: { color: AMBER, fontSize: 13, marginTop: 4, marginBottom: 8 },
  userWrap: { alignItems: 'flex-end', marginVertical: 5 },
  routineTag: { color: MUTED, fontSize: 11, marginBottom: 3 },
  userBubble: {
    backgroundColor: USER,
    borderRadius: 22,
    paddingVertical: 9,
    paddingHorizontal: 16,
    maxWidth: '84%',
  },
  userText: { color: USER_TEXT, fontSize: 15, lineHeight: 21 },
  queued: { color: AMBER, fontSize: 11, marginTop: 3 },
  botWrap: { alignItems: 'flex-start', marginVertical: 5, gap: 6 },
  tools: { gap: 2, maxWidth: '90%' },
  tool: { color: '#7a7a7a', fontSize: 12 },
  botBubble: {
    backgroundColor: BUBBLE,
    borderColor: BUBBLE_LINE,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 14,
    maxWidth: '90%',
  },
  note: { color: MUTED, fontSize: 12, fontStyle: 'italic' },
  card: {
    width: '92%',
    backgroundColor: '#141414',
    borderColor: '#333333',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, color: '#f2f2f2', fontSize: 14, fontWeight: '700' },
  env: {
    color: '#d4d4d4',
    fontSize: 11,
    backgroundColor: '#262626',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  envHot: { color: '#fecaca', backgroundColor: '#4c1d1d' },
  danger: { color: '#fca5a5', fontSize: 13, fontWeight: '600' },
  reason: { color: '#d4d4d4', fontSize: 13 },
  mono: {
    color: '#e5e5e5',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    padding: 8,
  },
  target: { color: MUTED, fontSize: 12 },
  output: {
    color: '#a3a3a3',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 },
  cardStatus: { flex: 1, color: MUTED, fontSize: 12 },
  cardButtons: { flexDirection: 'row', gap: 8 },
  denyBtn: { borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#262626' },
  denyText: { color: '#e5e5e5', fontSize: 13, fontWeight: '600' },
  approveBtn: { borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#f2f2f2' },
  reallyBtn: { backgroundColor: '#fca5a5' },
  approveText: { color: '#000000', fontSize: 13, fontWeight: '700' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    backgroundColor: BG,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    color: '#f2f2f2',
    fontSize: 15,
    backgroundColor: '#1a1a1a',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 21,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#f2f2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
  sendText: { color: '#000000', fontSize: 20, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#161616', borderRadius: 20, padding: 18, gap: 10 },
  modalTitle: { color: '#f2f2f2', fontSize: 17, fontWeight: '700' },
  modalText: { color: '#bdbdbd', fontSize: 14, lineHeight: 20 },
  codeInput: {
    color: '#f2f2f2',
    fontSize: 20,
    letterSpacing: 4,
    backgroundColor: '#0d0d0d',
    borderRadius: 12,
    padding: 12,
    textAlign: 'center',
  },
  modalError: { color: '#fca5a5', fontSize: 13 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
})
