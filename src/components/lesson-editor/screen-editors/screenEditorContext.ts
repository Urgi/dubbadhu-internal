/**
 * Everything a per-screen-type editor reads from LessonScreenEditModal (state, setters, refs, save hooks).
 * Built once per render in LessonScreenEditModal's structuredForm.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { AudioExposureLinkOption, LessonScreen } from '../../../lib/lessonEditor'
import type { LessonHarvestPickerWord, TranslationConflictPrompt, TranslationConflictPayload } from '../lessonEditorShared'

export type ScreenEditorContext = {
  allowJsonEditing: boolean
  allowVideoReviewMediaFields: boolean
  audioExposureBankSaveBusyRef: RefObject<boolean>
  audioExposureOromoTypingIgnoreUntilRef: RefObject<Map<number, number>>
  audioExposureSpeakingLinkOptions: AudioExposureLinkOption[]
  c: Record<string, unknown>
  draftRef: RefObject<LessonScreen | null>
  exposureWordsForAfaanPicker: LessonHarvestPickerWord[]
  isReadOnly: boolean
  lessonContentSeries: string | null
  lessonScreens: LessonScreen[]
  lessonSeries: string | null
  onPressQuizAllFromSeries: () => void
  patternCorrectOpen: boolean
  primaryScreenSaveRef: RefObject<(() => void) | null>
  promptTranslationConflict: TranslationConflictPrompt
  quizCorrectModalQ: number | null
  quizExpandedQuestionIdx: number
  readOnlyMode: boolean
  registerPrimaryScreenSave: (fn: () => void) => void
  reportScreenSaveError: (message: string) => void
  saveStructured: (content: Record<string, unknown>) => void
  seriesMatchFillBusy: boolean
  seriesNoTranslationVideoUrl: string | null
  setContent: (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => void
  setJsonError: Dispatch<SetStateAction<string>>
  setPatternCorrectOpen: Dispatch<SetStateAction<boolean>>
  setQuizCorrectModalQ: Dispatch<SetStateAction<number | null>>
  setQuizExpandedQuestionIdx: Dispatch<SetStateAction<number>>
  setScreenSaveBusy: Dispatch<SetStateAction<boolean>>
  setTextQuizExpandedQuestionIdx: Dispatch<SetStateAction<number>>
  setTranslationConflict: Dispatch<SetStateAction<TranslationConflictPayload | null>>
  setVideoReviewActiveLineId: Dispatch<SetStateAction<string | null>>
  setVideoReviewVocabFocusKey: Dispatch<SetStateAction<string>>
  textQuizExpandedQuestionIdx: number
  videoReviewActiveLineId: string | null
  videoReviewVocabFocusKey: string
  wordBankSeriesLabels: string[]
}
