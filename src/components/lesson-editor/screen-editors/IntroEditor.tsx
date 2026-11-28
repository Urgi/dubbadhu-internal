/** Lesson editor form for `intro` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { View } from 'react-native'
import {
  Field,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderIntroEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, primaryScreenSaveRef, saveStructured, setContent } = ctx
  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const goal = String((d.content as Record<string, unknown>).goal ?? '')
    saveStructured({ goal })
  }
  return (
    <View style={styles.form}>
      <Field label="Goal" value={String(c.goal ?? '')} onChangeText={(t) => setContent((cur) => ({ ...cur, goal: t }))} />
    </View>
  )
}
