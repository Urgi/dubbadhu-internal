import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { OBSIDIAN_CREW_LIST } from '../../lib/obsidianCrew'
import type { ObsidianCrewRoute } from '../../lib/obsidian'

type Props = {
  visible: boolean
  onClose: () => void
  onPick: (route: ObsidianCrewRoute) => void
}

export default function ObsidianDelegateSheet({ visible, onClose, onPick }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Delegate</Text>
          <Text style={styles.lede}>Hand a job to a specialist. Obsidian stays in this thread.</Text>
          {OBSIDIAN_CREW_LIST.map((agent) => (
            <Pressable
              key={agent.id}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => {
                onPick(agent.id)
                onClose()
              }}
            >
              <View style={[styles.dot, { backgroundColor: agent.color }]} />
              <View style={styles.rowText}>
                <Text style={styles.name}>{agent.name}</Text>
                <Text style={styles.handles}>{agent.handles}</Text>
              </View>
            </Pressable>
          ))}
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 8,
  },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  lede: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  pressed: { opacity: 0.85 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  rowText: { flex: 1, gap: 2 },
  name: { color: '#f9fafb', fontSize: 16, fontWeight: '700' },
  handles: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
  cancel: { alignItems: 'center', paddingTop: 10 },
  cancelText: { color: '#6b7280', fontSize: 15, fontWeight: '600' },
})
