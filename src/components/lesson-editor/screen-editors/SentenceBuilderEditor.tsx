/** Lesson editor form for `sentenceBuilder` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Text, View } from 'react-native'
import {
  Field,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderSentenceBuilderEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const english = String(content.english ?? '').trim()
    const words = (Array.isArray(content.words) ? content.words : [])
      .map((word) => String(word ?? '').trim())
      .filter(Boolean)
    if (!english || words.length < 2) {
      setJsonError('Add an English cue and at least two ordered Afaan Oromo words.')
      return
    }
    saveStructured({
      ...(String(content.title ?? '').trim()
        ? { title: String(content.title ?? '').trim() }
        : {}),
      ...(String(content.instruction ?? '').trim()
        ? { instruction: String(content.instruction ?? '').trim() }
        : {}),
      english,
      words,
      ...(String(content.audio ?? '').trim()
        ? { audio: String(content.audio ?? '').trim() }
        : {}),
      ...(String(content.tip ?? '').trim() ? { tip: String(content.tip ?? '').trim() } : {}),
    })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Enter the target sentence as ordered chunks, one chunk per line. The learner sees them
        shuffled and taps them into Afaan Oromo sentence order.
      </Text>
      <Field
        label="Title (optional)"
        value={String(c.title ?? '')}
        onChangeText={(title) => setContent((cur) => ({ ...cur, title }))}
      />
      <Field
        label="Instruction (optional)"
        value={String(c.instruction ?? '')}
        onChangeText={(instruction) => setContent((cur) => ({ ...cur, instruction }))}
      />
      <Field
        label="English cue"
        value={String(c.english ?? '')}
        onChangeText={(english) => setContent((cur) => ({ ...cur, english }))}
      />
      <Field
        label="Ordered Afaan Oromo chunks (one per line)"
        allowMultiline
        value={(Array.isArray(c.words) ? c.words : []).map((word) => String(word)).join('\n')}
        onChangeText={(value) =>
          setContent((cur) => ({
            ...cur,
            words: value.split('\n'),
          }))
        }
      />
      <Field
        label="Model sentence audio URL (optional)"
        value={String(c.audio ?? '')}
        onChangeText={(audio) => setContent((cur) => ({ ...cur, audio }))}
      />
      <Field
        label="Tip after answer (optional)"
        allowMultiline
        value={String(c.tip ?? '')}
        onChangeText={(tip) => setContent((cur) => ({ ...cur, tip }))}
      />
    </View>
  )
}
