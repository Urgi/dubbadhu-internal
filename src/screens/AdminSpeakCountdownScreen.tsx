import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import type { StackScreenProps } from '@react-navigation/stack'
import { ADMIN_ACCENT_GOLD } from '../components/lesson-config/AdminLessonConfigChrome'
import supabase from '../lib/supabase'
import type { RootStackParamList } from '../types'

type Props = StackScreenProps<RootStackParamList, 'AdminSpeakCountdown'>

/** Arizona has no daylight saving: always UTC-7, same as the learner countdown. */
const AZ_OFFSET_MS = -7 * 60 * 60 * 1000

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** ISO timestamp → { date: 'YYYY-MM-DD', time: 'HH:MM' } in Arizona time. */
function toArizonaFields(iso: string | null): { date: string; time: string } {
  const ms = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(ms)) return { date: '', time: '00:00' }
  const az = new Date(ms + AZ_OFFSET_MS)
  return {
    date: `${az.getUTCFullYear()}-${pad2(az.getUTCMonth() + 1)}-${pad2(az.getUTCDate())}`,
    time: `${pad2(az.getUTCHours())}:${pad2(az.getUTCMinutes())}`,
  }
}

/** Arizona date + time → UTC ms, or null if invalid. */
function fromArizonaFields(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const t = /^(\d{1,2}):(\d{2})$/.exec((time.trim() || '00:00'))
  if (!d || !t) return null
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || mi > 59) return null
  return Date.UTC(y, mo - 1, day, h, mi) - AZ_OFFSET_MS
}

function describeCountdown(targetMs: number) {
  const totalMinutes = Math.floor(Math.max(0, targetMs - Date.now()) / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  return `${days}d ${hours}h ${minutes}m from now`
}

export default function AdminSpeakCountdownScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('00:00')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('app_config')
      .select('speak_next_series_at')
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      Alert.alert('Load failed', error.message)
      return
    }
    const iso = (data as { speak_next_series_at: string | null } | null)?.speak_next_series_at ?? null
    const fields = toArizonaFields(iso)
    setDate(fields.date)
    setTime(fields.time)
    setSavedAt(iso)
  }, [])

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
      title: 'Speak countdown',
      headerStyle: { backgroundColor: '#000000' },
      headerTitleStyle: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
      headerTintColor: '#ffffff',
    })
  }, [navigation])

  const targetMs = useMemo(() => fromArizonaFields(date, time), [date, time])

  const write = useCallback(
    async (value: string | null, doneMessage: string) => {
      setSaving(true)
      const { error } = await supabase
        .from('app_config')
        .update({ speak_next_series_at: value })
        .eq('id', 1)
      setSaving(false)
      if (error) {
        Alert.alert('Save failed', error.message)
        return
      }
      Alert.alert('Saved', doneMessage)
      await load()
    },
    [load],
  )

  const save = useCallback(() => {
    if (targetMs == null) {
      Alert.alert('Check the date', 'Use YYYY-MM-DD and HH:MM (24-hour), Arizona time.')
      return
    }
    if (targetMs <= Date.now()) {
      Alert.alert('Date is in the past', 'Learners would see the fallback countdown instead.')
      return
    }
    void write(
      new Date(targetMs).toISOString(),
      'Learners see the new countdown next time they open the Speak tab.',
    )
  }, [targetMs, write])

  const clear = useCallback(() => {
    Alert.alert(
      'Clear countdown date?',
      'Learners fall back to the date built into the app, then the 1st of each month.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => void write(null, 'Cleared. Learners see the built-in fallback.'),
        },
      ],
    )
  }, [write])

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={ADMIN_ACCENT_GOLD} style={{ marginTop: 40 }} />
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>
        The “next series” countdown learners see on the Speak tab once they finish every
        published series. Times are Arizona time. Publishing the series is separate: do that
        from the series screen when it’s ready.
      </Text>

      <Text style={styles.meta}>
        {savedAt
          ? `Saved: ${toArizonaFields(savedAt).date} ${toArizonaFields(savedAt).time} Arizona${
              Date.parse(savedAt) <= Date.now() ? ' (passed, so learners see the fallback)' : ''
            }`
          : 'Not set. Learners see the built-in fallback.'}
      </Text>

      <Text style={styles.label}>Release date (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 2026-11-03"
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
        value={date}
        onChangeText={setDate}
      />

      <Text style={styles.label}>Release time (HH:MM, 24-hour, Arizona)</Text>
      <TextInput
        style={styles.input}
        placeholder="00:00"
        placeholderTextColor="#666"
        autoCapitalize="none"
        autoCorrect={false}
        value={time}
        onChangeText={setTime}
      />

      <Text style={styles.preview}>
        {targetMs == null ? 'Enter a valid date and time.' : describeCountdown(targetMs)}
      </Text>

      <Pressable style={styles.secondaryBtn} onPress={clear} disabled={saving}>
        <Text style={styles.secondaryBtnText}>Clear date</Text>
      </Pressable>

      <Pressable
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={save}
        disabled={saving}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 16, paddingBottom: 48 },
  hint: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  meta: { color: '#6b7280', fontSize: 12, marginBottom: 12 },
  label: { color: '#9ca3af', fontSize: 12, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  preview: { color: ADMIN_ACCENT_GOLD, fontSize: 14, fontWeight: '700', marginTop: 14 },
  secondaryBtn: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#d1d5db', fontWeight: '700' },
  saveBtn: {
    marginTop: 12,
    backgroundColor: ADMIN_ACCENT_GOLD,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
})
