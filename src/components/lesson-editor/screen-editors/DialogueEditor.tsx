/** Lesson editor form for `dialogue` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { DialogueTwoPersonEditor } from '../DialogueTwoPersonEditor'
import {
  DialogueVideoTimingReference,
  Field,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderDialogueEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, readOnlyMode, registerPrimaryScreenSave, saveStructured, seriesNoTranslationVideoUrl, setContent } = ctx
  const parseClipSecondInput = (
    rawIn: string,
  ):
    | { action: 'clear' }
    | { action: 'keep' }
    | { action: 'set'; value: number | string } => {
    const raw = String(rawIn ?? '')
      .trim()
      .replace(',', '.')
    if (raw === '') return { action: 'clear' }
    // Allow in-progress typing like "3." before the fractional digits.
    if (!/^\d*\.?\d*$/.test(raw)) return { action: 'keep' }
    if (raw === '.' || raw.endsWith('.')) return { action: 'set', value: raw }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return { action: 'keep' }
    return { action: 'set', value: n }
  }
  return (
    <View style={styles.form}>
      <Text style={styles.label}>Dialogue playback clip (optional)</Text>
      <Text style={styles.hint}>
        Plays the series no-translation video from these seconds (decimals OK, e.g. 3.5). Leave
        blank to hide the video button on the learner dialogue screen.
      </Text>
      <DialogueVideoTimingReference
        videoUrl={String(seriesNoTranslationVideoUrl ?? '')}
        fromSecond={c.fromSecond}
        toSecond={c.toSecond}
      />
      <View style={styles.rowSwitch}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Field
            label="From second"
            value={
              c.fromSecond == null || c.fromSecond === ''
                ? ''
                : String(c.fromSecond)
            }
            keyboardType="decimal-pad"
            onChangeText={(t) =>
              setContent((cur) => {
                const next = { ...cur }
                const parsed = parseClipSecondInput(t)
                if (parsed.action === 'clear') delete next.fromSecond
                else if (parsed.action === 'keep') return cur
                else next.fromSecond = parsed.value
                return next
              })
            }
          />
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Field
            label="To second"
            value={
              c.toSecond == null || c.toSecond === '' ? '' : String(c.toSecond)
            }
            keyboardType="decimal-pad"
            onChangeText={(t) =>
              setContent((cur) => {
                const next = { ...cur }
                const parsed = parseClipSecondInput(t)
                if (parsed.action === 'clear') delete next.toSecond
                else if (parsed.action === 'keep') return cur
                else next.toSecond = parsed.value
                return next
              })
            }
          />
        </View>
      </View>
      <DialogueTwoPersonEditor
        content={c}
        setContent={setContent}
        hideFooterSave
        readOnly={readOnlyMode}
        onRegisterHeaderSave={registerPrimaryScreenSave}
        onSave={() => {
          const d = draftRef.current
          if (!d) return
          saveStructured({ ...(d.content as Record<string, unknown>) })
        }}
      />
    </View>
  )
}
