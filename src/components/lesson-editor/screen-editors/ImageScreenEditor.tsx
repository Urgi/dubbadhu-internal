/** Lesson editor form for `imageScreen` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Text, View } from 'react-native'
import {
  Field,
  ImageScreenMediaField,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderImageScreenEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, primaryScreenSaveRef, saveStructured, setContent } = ctx
  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const cur = d.content as Record<string, unknown>
    saveStructured({
      image: String(cur.image ?? '').trim(),
      imagePrompt: String(cur.imagePrompt ?? '').trim(),
      title: String(cur.title ?? '').trim(),
      body: String(cur.body ?? '').trim(),
    })
  }
  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Hero image with title and body. Generate with Gemini, regenerate until you like it, then upload — or paste a
        public URL.
      </Text>
      <ImageScreenMediaField
        image={String(c.image ?? '')}
        imagePrompt={String(c.imagePrompt ?? '')}
        setContent={setContent}
      />
      <Field
        label="Title"
        value={String(c.title ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, title: t }))}
      />
      <Field
        label="Body"
        allowMultiline
        value={String(c.body ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, body: t }))}
      />
    </View>
  )
}
