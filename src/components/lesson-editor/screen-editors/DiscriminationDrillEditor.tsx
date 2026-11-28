/** Lesson editor form for `discriminationDrill` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import {
  WordDiscriminationQuizEditor,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderDiscriminationDrillEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, lessonContentSeries, lessonScreens, lessonSeries, readOnlyMode, registerPrimaryScreenSave, saveStructured, setContent, setJsonError } = ctx
  return (
    <WordDiscriminationQuizEditor
      content={c as Record<string, unknown>}
      setContent={setContent}
      lessonScreens={lessonScreens}
      lessonSeries={lessonSeries ?? null}
      lessonContentSeries={lessonContentSeries ?? null}
      saveStructured={saveStructured}
      draftRef={draftRef}
      setJsonError={setJsonError}
      registerPrimarySave={registerPrimaryScreenSave}
      readOnly={readOnlyMode}
    />
  )
}
