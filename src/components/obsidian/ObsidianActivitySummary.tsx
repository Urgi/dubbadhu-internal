import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ActivitySummary } from '../../lib/obsidianActivity'

type Props = {
  summary: ActivitySummary
  onViewTimeline: () => void
  onMonitor: () => void
  onFollowUp: () => void
}

export default function ObsidianActivitySummary({
  summary,
  onViewTimeline,
  onMonitor,
  onFollowUp,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{summary.title}</Text>
      {summary.lede ? <Text style={styles.lede}>{summary.lede}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.kicker}>Activity</Text>
        {summary.items.map((item) => (
          <View key={item.label} style={styles.row}>
            <Text style={[styles.mark, !item.done && styles.markOff]}>{item.done ? '✓' : '—'}</Text>
            <Text style={[styles.item, !item.done && styles.itemOff]}>{item.label}</Text>
          </View>
        ))}
      </View>

      {summary.read ? (
        <View style={styles.readBlock}>
          <Text style={styles.kicker}>Obsidian’s read</Text>
          <Text style={styles.lede}>{summary.read}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Chip label="View timeline" onPress={onViewTimeline} />
        <Chip label="Monitor user" onPress={onMonitor} />
        <Chip label="Ask follow-up" onPress={onFollowUp} />
      </View>
    </View>
  )
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  title: {
    color: '#ffffff',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    marginBottom: 8,
  },
  lede: {
    color: '#e8e8ea',
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 10,
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  kicker: {
    color: '#8b8b8b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  mark: {
    width: 18,
    color: '#86efac',
    fontSize: 15,
    lineHeight: 22,
  },
  markOff: { color: '#6b7280' },
  item: {
    flexShrink: 1,
    color: '#f4f4f5',
    fontSize: 16,
    lineHeight: 22,
  },
  itemOff: { color: '#9ca3af' },
  readBlock: { marginBottom: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { color: '#f4f4f5', fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.85 },
})
