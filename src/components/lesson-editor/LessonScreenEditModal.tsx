import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { AdminTextInput } from '../AdminTextInput'
import type { LessonScreen } from '../../lib/lessonEditor'
import {
  celebrateAfaanDedupeKey,
  finalizeScreenContentPayload,
  findAudioExposureWordsBlockingLessonSave,
  formatAudioExposureDraftGapsForLessonSave,
  listAudioExposureLinkOptionsFromScreens,
  normalizeAudioExposureContentForEdit,
  normalizeDialogueContent,
  normalizeVideoReviewContentForEdit,
  normalizeWordDiscriminationContentForEdit,
} from '../../lib/lessonEditor'
import { fetchSeriesMatchPairsFromLessons } from '../../lib/fetchSeriesMatchPairs'
import { buildWordBankLookupLabels } from '../../lib/seedWordsFromLessons'
import { VOICE_BANK_LANGUAGE } from '../../lib/voiceBankLabels'
import { LessonScreenLearnerPreview } from './LessonScreenLearnerPreview'
import { TranslationMismatchModal } from './TranslationMismatchModal'
import {
  LessonEditorReadOnlyContext,
  type Props,
  STRUCTURED_SCREEN_TYPES_FOR_HEADER_SAVE,
  type TranslationConflictChoice,
  type TranslationConflictPayload,
  type TranslationConflictPrompt,
  cloneScreen,
  fetchWordTranslationsByIds,
  harvestAudioExposureWordsForPicker,
  isUuidLike,
  modalContentDirtyForRole,
  screenTypeTitle,
  styles,
} from './lessonEditorShared'
import type { ScreenEditorContext } from './screen-editors/screenEditorContext'
import { renderIntroEditor } from './screen-editors/IntroEditor'
import { renderConceptEditor } from './screen-editors/ConceptEditor'
import { renderDialogueEditor } from './screen-editors/DialogueEditor'
import { renderMatchEditor } from './screen-editors/MatchEditor'
import { renderQuizEditor } from './screen-editors/QuizEditor'
import { renderTextQuizEditor } from './screen-editors/TextQuizEditor'
import { renderSpeakingPracticeEditor } from './screen-editors/SpeakingPracticeEditor'
import { renderAudioExposureEditor } from './screen-editors/AudioExposureEditor'
import { renderCelebrateEditor } from './screen-editors/CelebrateEditor'
import { renderCommunityBoardEditor } from './screen-editors/CommunityBoardEditor'
import { renderPatternPracticeEditor } from './screen-editors/PatternPracticeEditor'
import { renderDiscriminationDrillEditor } from './screen-editors/DiscriminationDrillEditor'
import { renderWordBreakdownEditor } from './screen-editors/WordBreakdownEditor'
import { renderVideoReviewEditor } from './screen-editors/VideoReviewEditor'
import { renderImageScreenEditor } from './screen-editors/ImageScreenEditor'
import { renderRepetitionEditor } from './screen-editors/RepetitionEditor'
import { renderRepetitionPracticeEditor } from './screen-editors/RepetitionPracticeEditor'
import { renderSentenceBuilderEditor } from './screen-editors/SentenceBuilderEditor'

export function LessonScreenEditModal({
  visible,
  screen,
  lessonScreens = [],
  lessonScreenIndex = null,
  lessonSeries = null,
  lessonId = null,
  lessonContentSeries = null,
  seriesNoTranslationVideoUrl = null,
  wordBankLanguage = VOICE_BANK_LANGUAGE,
  allowJsonEditing = true,
  allowVideoReviewMediaFields = true,
  readOnly = false,
  onClose: onCloseFromParent,
  onApply,
}: Props) {
  const isReadOnly = Boolean(readOnly)
  const [draft, setDraft] = useState<LessonScreen | null>(null)
  const [jsonFallback, setJsonFallback] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [screenSaveBusy, setScreenSaveBusy] = useState(false)
  const [seriesMatchFillBusy, setSeriesMatchFillBusy] = useState(false)
  const modalScrollRef = useRef<ScrollView>(null)
  /** Which quiz question index is showing the “correct answer” picker (`null` = closed). */
  const [quizCorrectModalQ, setQuizCorrectModalQ] = useState<number | null>(null)
  /** Accordion: only one quiz question body expanded at a time. */
  const [quizExpandedQuestionIdx, setQuizExpandedQuestionIdx] = useState(0)
  /** Accordion for the text quiz screen (separate from the word-bank quiz above). */
  const [textQuizExpandedQuestionIdx, setTextQuizExpandedQuestionIdx] = useState(0)
  const [patternCorrectOpen, setPatternCorrectOpen] = useState(false)
  /** Video review: one expanded line at a time; lines with vocab are minimized unless this is their `id` (`null` = none). */
  const [videoReviewActiveLineId, setVideoReviewActiveLineId] = useState<string | null>(null)
  /** Which vocab/line editor has focus — closes other rows’ word-bank dropdowns so they don’t block taps. */
  const [videoReviewVocabFocusKey, setVideoReviewVocabFocusKey] = useState('')
  const draftRef = useRef<LessonScreen | null>(null)
  draftRef.current = draft
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const baselineScreenRef = useRef<LessonScreen | null>(null)
  const baselineJsonTextRef = useRef('')
  /** Wired by each structured editor (or inline in switch); header Save invokes this. */
  const primaryScreenSaveRef = useRef<(() => void) | null>(null)
  const registerPrimaryScreenSave = useCallback((fn: () => void) => {
    primaryScreenSaveRef.current = fn
  }, [])

  /** Professors often scroll past the top error line — alert + scroll so save failures are visible. */
  const reportScreenSaveError = useCallback((message: string) => {
    const msg = message.trim()
    if (!msg) return
    setJsonError(msg)
    requestAnimationFrame(() => {
      modalScrollRef.current?.scrollToEnd({ animated: true })
    })
    Alert.alert('Could not save screen', msg)
  }, [])

  /**
   * After choosing a word-bank row, RN can emit a stale `onChangeText` on the Afaan field (blur/keyboard timing).
   * That handler used to spread the word then delete `translation`, reverting the pick.
   */
  const audioExposureOromoTypingIgnoreUntilRef = useRef<Map<number, number>>(new Map())

  const exposureWordsForAfaanPicker = useMemo(() => {
    const idx = lessonScreenIndex
    let screens = lessonScreens
    if (typeof idx === 'number' && idx >= 0 && idx < lessonScreens.length) {
      const overlay = draft ?? screen
      if (overlay) {
        screens = lessonScreens.map((s, i) => (i === idx ? overlay : s))
      }
    }
    return harvestAudioExposureWordsForPicker(screens)
  }, [lessonScreens, lessonScreenIndex, draft, screen])

  const audioExposureSpeakingLinkOptions = useMemo(() => {
    const idx = lessonScreenIndex
    let screens = lessonScreens
    if (typeof idx === 'number' && idx >= 0 && idx < lessonScreens.length) {
      const overlay = draft ?? screen
      if (overlay) {
        screens = lessonScreens.map((s, i) => (i === idx ? overlay : s))
      }
    }
    return listAudioExposureLinkOptionsFromScreens(screens)
  }, [lessonScreens, lessonScreenIndex, draft, screen])

  const [wordBankSeriesLabels, setWordBankSeriesLabels] = useState<string[]>([])
  useEffect(() => {
    let cancel = false
    void (async () => {
      const labels = await buildWordBankLookupLabels(lessonSeries, lessonContentSeries)
      if (!cancel) setWordBankSeriesLabels(labels)
    })()
    return () => {
      cancel = true
    }
  }, [lessonSeries, lessonContentSeries])

  useEffect(() => {
    if (!visible || !draft || draft.type !== 'quiz') return
    const raw = (draft.content as Record<string, unknown>).questions
    const n = Array.isArray(raw) && raw.length > 0 ? raw.length : 1
    setQuizExpandedQuestionIdx((i) => Math.max(0, Math.min(i, n - 1)))
    setQuizCorrectModalQ((open) => (open != null && open >= n ? null : open))
  }, [visible, draft, draft?.type, draft?.content])

  useEffect(() => {
    if (visible && screen) {
      audioExposureOromoTypingIgnoreUntilRef.current.clear()
      let c = cloneScreen(screen)
      if (
        c.type === 'dialogue'
      ) {
        c = {
          ...c,
          content: normalizeDialogueContent(c.content as Record<string, unknown>),
        }
      }
      {
        const st = c.type as string
        if (st === 'discriminationDrill' || st === 'wordDiscriminationQuiz') {
          c = {
            ...c,
            type: 'discriminationDrill',
            content: normalizeWordDiscriminationContentForEdit(c.content as Record<string, unknown>),
          }
        }
        if (st === 'animatedConcept') {
          c = { ...c, type: 'concept' }
        }
      }
      if (c.type === 'videoReview') {
        c = {
          ...c,
          content: normalizeVideoReviewContentForEdit(c.content as Record<string, unknown>),
        }
      }
      if (c.type === 'audioExposure') {
        c = {
          ...c,
          content: normalizeAudioExposureContentForEdit(c.content as Record<string, unknown>),
        }
      }
      baselineScreenRef.current = c
      try {
        const js = JSON.stringify(c.content, null, 2)
        baselineJsonTextRef.current = js
        setJsonFallback(js)
      } catch {
        baselineJsonTextRef.current = '{}'
        setJsonFallback('{}')
      }
      setDraft(c)
      setJsonError('')
      setVideoReviewActiveLineId(null)
      setVideoReviewVocabFocusKey('')
    } else if (!visible) {
      audioExposureOromoTypingIgnoreUntilRef.current.clear()
    }
  }, [visible, screen])

  /** Lean `word_id` tokens often omit `translation` in JSON; fill from `words` so the Translation row is visible. */
  useEffect(() => {
    if (!visible || !screen || screen.type !== 'audioExposure') return
    const normalized = normalizeAudioExposureContentForEdit(screen.content as Record<string, unknown>)
    const wordsRaw = normalized.words
    if (!Array.isArray(wordsRaw)) return
    const needIds: string[] = []
    for (const w of wordsRaw) {
      if (w == null || typeof w !== 'object' || Array.isArray(w)) continue
      const rec = w as Record<string, unknown>
      const wid = String(rec.word_id ?? '').trim().toLowerCase()
      if (!isUuidLike(wid)) continue
      const gloss = String(rec.translation ?? rec.english ?? '').trim()
      if (!gloss) needIds.push(wid)
    }
    if (needIds.length === 0) return
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        const byId = await fetchWordTranslationsByIds(needIds)
        if (cancelled || byId.size === 0) return
        setDraft((d) => {
          if (!d || d.type !== 'audioExposure') return d
          const co = d.content as Record<string, unknown>
          const ws = (co.words as Record<string, unknown>[]) ?? []
          if (!Array.isArray(ws)) return d
          let changed = false
          const next = ws.map((item) => {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) return item
            const rec = item as Record<string, unknown>
            const wid = String(rec.word_id ?? '').trim().toLowerCase()
            if (!isUuidLike(wid)) return item
            const have = String(rec.translation ?? rec.english ?? '').trim()
            if (have) return item
            const g = byId.get(wid)
            if (!g) return item
            changed = true
            const merged: Record<string, unknown> = { ...rec, translation: g }
            delete merged.english
            return merged
          })
          if (!changed) return d
          return { ...d, content: { ...co, words: next } }
        })
      })()
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [visible, screen])

  useEffect(() => {
    if (draft?.type !== 'videoReview' || videoReviewActiveLineId == null) return
    const c = draft.content as Record<string, unknown>
    const lines = Array.isArray(c.lines) ? (c.lines as Record<string, unknown>[]) : []
    const exists = lines.some((l, i) => String(l?.id ?? `line_${i + 1}`).trim() === videoReviewActiveLineId)
    if (!exists) setVideoReviewActiveLineId(null)
  }, [draft, videoReviewActiveLineId])

  const requestClose = useCallback(() => {
    if (isReadOnly) {
      onCloseFromParent()
      return
    }
    if (!visible || !screen) {
      onCloseFromParent()
      return
    }
    if (!draft) {
      onCloseFromParent()
      return
    }
    const b = baselineScreenRef.current
    if (!b) {
      onCloseFromParent()
      return
    }
    if (
      !modalContentDirtyForRole(
        allowJsonEditing,
        draft,
        jsonFallback,
        b,
        baselineJsonTextRef.current,
        isReadOnly,
      )
    ) {
      onCloseFromParent()
      return
    }
    Alert.alert(
      'Discard edits?',
      'You have changes to this screen that were not applied to the lesson.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => onCloseFromParent() },
      ],
    )
  }, [visible, screen, draft, jsonFallback, allowJsonEditing, onCloseFromParent, isReadOnly])

  const [translationConflict, setTranslationConflict] = useState<TranslationConflictPayload | null>(null)
  const translationConflictResolveRef = useRef<((c: TranslationConflictChoice) => void) | null>(null)
  const translationConflictKeyRef = useRef(0)
  /** Prevents overlapping Audio exposure saves from clobbering the conflict resolver ref. */
  const audioExposureBankSaveBusyRef = useRef(false)

  /** Defer opening to the next frame so sequential conflicts reliably repaint (embedded overlay + RN batching). */
  const promptTranslationConflict = useCallback<TranslationConflictPrompt>(
    (args) =>
      new Promise((resolve) => {
        translationConflictResolveRef.current = resolve
        translationConflictKeyRef.current += 1
        const payload: TranslationConflictPayload = { key: translationConflictKeyRef.current, ...args }
        requestAnimationFrame(() => {
          if (!visibleRef.current) {
            const stuck = translationConflictResolveRef.current
            translationConflictResolveRef.current = null
            stuck?.('cancel')
            return
          }
          setTranslationConflict(payload)
        })
      }),
    [],
  )

  /** Do not clear overlay before fn(choice): removing the layer first lets the same touch fall through to "Save screen" / header and close the editor mid-resolve. */
  const finishTranslationConflict = useCallback((choice: TranslationConflictChoice) => {
    const fn = translationConflictResolveRef.current
    translationConflictResolveRef.current = null
    fn?.(choice)
    setTranslationConflict(null)
  }, [])

  useEffect(() => {
    if (visible) return
    const fn = translationConflictResolveRef.current
    translationConflictResolveRef.current = null
    setTranslationConflict(null)
    if (fn) fn('cancel')
  }, [visible])

  /** Must stay above any early return — Rules of Hooks. */
  const patchDraftContent = useCallback(
    (patch: Record<string, unknown> | ((cur: Record<string, unknown>) => Record<string, unknown>)) => {
      if (isReadOnly) return
      setDraft((d) => {
        if (!d) return null
        const curContent = d.content as Record<string, unknown>
        const next = typeof patch === 'function' ? patch(curContent) : patch
        return { ...d, content: next }
      })
    },
    [isReadOnly],
  )

  const applySeriesMatchPairs = useCallback(
    async (replace: boolean) => {
      const sid = String(lessonSeries ?? '').trim()
      if (!sid || isReadOnly) return
      setSeriesMatchFillBusy(true)
      setJsonError('')
      try {
        const { pairs, lessonCount } = await fetchSeriesMatchPairsFromLessons(sid, {
          currentLessonId: lessonId,
          currentScreens: lessonScreens,
        })
        if (pairs.length === 0) {
          setJsonError(
            lessonCount === 0
              ? 'No lessons found in this series.'
              : 'No Afaan↔English pairs found across this series yet (exposure, match, video-review vocab, speaking, repetition).',
          )
          return
        }
        patchDraftContent((cur) => {
          if (replace) return { ...cur, pairs }
          const existing = Array.isArray(cur.pairs) ? (cur.pairs as Record<string, unknown>[]) : []
          const seen = new Set(
            existing
              .map((p) => celebrateAfaanDedupeKey(String(p.left ?? '')))
              .filter(Boolean),
          )
          const merged = [...existing]
          for (const row of pairs) {
            const k = celebrateAfaanDedupeKey(row.left)
            if (!k || seen.has(k)) continue
            seen.add(k)
            merged.push({ left: row.left, right: row.right })
          }
          return { ...cur, pairs: merged }
        })
      } catch (e) {
        setJsonError(e instanceof Error ? e.message : 'Could not load series pairs.')
      } finally {
        setSeriesMatchFillBusy(false)
      }
    },
    [isReadOnly, lessonSeries, lessonId, lessonScreens, patchDraftContent],
  )

  const onPressQuizAllFromSeries = useCallback(() => {
    if (isReadOnly || seriesMatchFillBusy) return
    const sid = String(lessonSeries ?? '').trim()
    if (!sid) {
      setJsonError('This lesson has no series id — open it from a curriculum series.')
      return
    }
    const curPairs = Array.isArray((draftRef.current?.content as Record<string, unknown> | undefined)?.pairs)
      ? ((draftRef.current!.content as Record<string, unknown>).pairs as unknown[])
      : []
    const hasPairs = curPairs.some((p) => {
      if (p == null || typeof p !== 'object') return false
      return Boolean(String((p as Record<string, unknown>).left ?? '').trim())
    })
    if (!hasPairs) {
      void applySeriesMatchPairs(true)
      return
    }
    Alert.alert('Quiz all from series', 'Replace existing pairs, or add only missing Afaan words?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add missing', onPress: () => void applySeriesMatchPairs(false) },
      { text: 'Replace all', style: 'destructive', onPress: () => void applySeriesMatchPairs(true) },
    ])
  }, [isReadOnly, seriesMatchFillBusy, lessonSeries, applySeriesMatchPairs])

  if (!visible || !screen || !draft) return null

  const applyJsonFallback = () => {
    try {
      const parsed = JSON.parse(jsonFallback) as Record<string, unknown>
      if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Content must be a JSON object.')
        return
      }
      setJsonError('')
      const d = draftRef.current
      if (!d) return
      const content = finalizeScreenContentPayload(d.type, parsed)
      if (d.type === 'audioExposure') {
        const gaps = findAudioExposureWordsBlockingLessonSave([
          { type: 'audioExposure', content } as LessonScreen,
        ])
        if (gaps.length > 0) {
          reportScreenSaveError(formatAudioExposureDraftGapsForLessonSave(gaps))
          return
        }
      }
      onApply({ type: d.type, content })
      onCloseFromParent()
    } catch {
      setJsonError('Invalid JSON.')
    }
  }

  const saveStructured = (content: Record<string, unknown>) => {
    const d = draftRef.current
    if (!d) return
    if (d.type === 'audioExposure') {
      const gaps = findAudioExposureWordsBlockingLessonSave([
        { type: 'audioExposure', content } as LessonScreen,
      ])
      if (gaps.length > 0) {
        reportScreenSaveError(formatAudioExposureDraftGapsForLessonSave(gaps))
        return
      }
    }
    const payload = finalizeScreenContentPayload(d.type, content)
    onApply({ type: d.type, content: payload })
    onCloseFromParent()
  }

  const structuredForm = (readOnlyMode: boolean) => {
    const c = draft.content
    const setContent = patchDraftContent
    primaryScreenSaveRef.current = null

    const ctx: ScreenEditorContext = {
      allowJsonEditing,
      allowVideoReviewMediaFields,
      audioExposureBankSaveBusyRef,
      audioExposureOromoTypingIgnoreUntilRef,
      audioExposureSpeakingLinkOptions,
      c,
      draftRef,
      exposureWordsForAfaanPicker,
      isReadOnly,
      lessonContentSeries,
      lessonScreens,
      lessonSeries,
      onPressQuizAllFromSeries,
      patternCorrectOpen,
      primaryScreenSaveRef,
      promptTranslationConflict,
      quizCorrectModalQ,
      quizExpandedQuestionIdx,
      readOnlyMode,
      registerPrimaryScreenSave,
      reportScreenSaveError,
      saveStructured,
      seriesMatchFillBusy,
      seriesNoTranslationVideoUrl,
      setContent,
      setJsonError,
      setPatternCorrectOpen,
      setQuizCorrectModalQ,
      setQuizExpandedQuestionIdx,
      setScreenSaveBusy,
      setTextQuizExpandedQuestionIdx,
      setTranslationConflict,
      setVideoReviewActiveLineId,
      setVideoReviewVocabFocusKey,
      textQuizExpandedQuestionIdx,
      videoReviewActiveLineId,
      videoReviewVocabFocusKey,
      wordBankSeriesLabels,
    }

    switch (draft.type) {
      case 'intro':
        return renderIntroEditor(ctx)
      case 'concept':
        return renderConceptEditor(ctx)
      case 'dialogue':
        return renderDialogueEditor(ctx)
      case 'match':
        return renderMatchEditor(ctx)
      case 'quiz':
        return renderQuizEditor(ctx)
      case 'textQuiz':
        return renderTextQuizEditor(ctx)
      case 'speakingPractice':
        return renderSpeakingPracticeEditor(ctx)
      case 'audioExposure':
        return renderAudioExposureEditor(ctx)
      case 'CelebrateScreen':
        return renderCelebrateEditor(ctx)
      case 'communityBoard':
        return renderCommunityBoardEditor(ctx)
      case 'patternPractice':
        return renderPatternPracticeEditor(ctx)
      case 'discriminationDrill':
        return renderDiscriminationDrillEditor(ctx)
      case 'word-breakdown':
        return renderWordBreakdownEditor(ctx)
      case 'videoReview':
        return renderVideoReviewEditor(ctx)
      case 'imageScreen':
        return renderImageScreenEditor(ctx)
      case 'repetition':
        return renderRepetitionEditor(ctx)
      case 'repetitionPractice':
        return renderRepetitionPracticeEditor(ctx)
      case 'sentenceBuilder':
        return renderSentenceBuilderEditor(ctx)
      default:
        return null
    }
  }

  const hasStructured = STRUCTURED_SCREEN_TYPES_FOR_HEADER_SAVE.has(draft.type)

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={requestClose}>
      <LessonEditorReadOnlyContext.Provider value={isReadOnly}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Pressable onPress={requestClose} hitSlop={12}>
            <Text style={styles.modalCancel}>{isReadOnly ? 'Close' : 'Cancel'}</Text>
          </Pressable>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {!allowVideoReviewMediaFields && draft.type === 'videoReview'
              ? 'Review'
              : screenTypeTitle(draft.type)}
          </Text>
          {isReadOnly ? (
            <View style={{ width: 56 }} />
          ) : (
          <Pressable
            onPress={() => {
              if (screenSaveBusy) return
              if (STRUCTURED_SCREEN_TYPES_FOR_HEADER_SAVE.has(draft.type)) {
                primaryScreenSaveRef.current?.()
                return
              }
              if (allowJsonEditing) applyJsonFallback()
            }}
            hitSlop={8}
            style={[styles.modalHeaderSave, screenSaveBusy && styles.modalHeaderSaveDisabled]}
            disabled={screenSaveBusy}
          >
            <Text style={styles.modalHeaderSaveText}>{screenSaveBusy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
          )}
        </View>
        <ScrollView
          ref={modalScrollRef}
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          keyboardShouldPersistTaps="always"
          removeClippedSubviews={false}
        >
          {draft.type === 'videoReview' ? null : (
            <View style={styles.screenHeader}>
              <Text style={styles.screenHeaderTitle}>{screenTypeTitle(draft.type)}</Text>
              <Text style={styles.screenHeaderSubtitle}>
                {isReadOnly
                  ? 'Preview only — same fields as admins see; changes are not saved.'
                  : allowJsonEditing
                  ? 'Adjust inputs below to modify/create screen.'
                  : draft.type === 'audioExposure'
                  ? 'Sample learner UI is shown below the word list so you can match fields to what students see.'
                  : 'Sample learner UI is shown above the form so you can match fields to what students see.'}
              </Text>
            </View>
          )}
          {!allowJsonEditing && draft.type !== 'audioExposure' ? (
            <LessonScreenLearnerPreview screenType={draft.type} />
          ) : null}
          {!allowJsonEditing && jsonError && draft.type !== 'audioExposure' ? (
            <Text style={styles.jsonErr}>{jsonError}</Text>
          ) : null}
          <View pointerEvents={isReadOnly ? 'none' : 'auto'} collapsable={false}>
          {hasStructured ? (
            structuredForm(isReadOnly)
          ) : allowJsonEditing ? (
            <Text style={styles.hint}>No simple form for this type yet — edit JSON below.</Text>
          ) : (
            <Text style={styles.hint}>
              This screen type doesn’t have a visual editor yet. Ask an admin to change it.
            </Text>
          )}
          </View>
          {!allowJsonEditing && draft.type === 'audioExposure' ? (
            <View style={styles.previewBelowForm}>
              <LessonScreenLearnerPreview screenType={draft.type} />
            </View>
          ) : null}
          {!allowJsonEditing && jsonError ? (
            <View style={styles.saveErrorBanner}>
              <Text style={styles.saveErrorBannerTitle}>Could not save</Text>
              <Text style={styles.saveErrorBannerText}>{jsonError}</Text>
            </View>
          ) : null}
          {allowJsonEditing ? (
            <>
              <Text style={styles.advancedLabel}>Screen content (JSON)</Text>
              {jsonError ? <Text style={styles.jsonErr}>{jsonError}</Text> : null}
              <AdminTextInput
                style={styles.jsonInput}
                allowMultiline
                value={jsonFallback}
                onChangeText={(t) => {
                  setJsonFallback(t)
                  setJsonError('')
                }}
                textAlignVertical="top"
              />
              <Pressable style={styles.applyJsonBtn} onPress={applyJsonFallback}>
                <Text style={styles.applyJsonText}>Apply JSON & close</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
        {translationConflict ? (
          <TranslationMismatchModal
            key={translationConflict.key}
            embedded
            visible
            afaan={translationConflict.afaan}
            lessonTranslation={translationConflict.lessonTranslation}
            databaseTranslation={translationConflict.databaseTranslation}
            conflictNumber={translationConflict.conflictNumber}
            totalConflicts={translationConflict.totalConflicts}
            onCancel={() => finishTranslationConflict('cancel')}
            onUseLesson={() => finishTranslationConflict('lesson')}
            onUseDatabase={() => finishTranslationConflict('database')}
          />
        ) : null}
      </View>
      </LessonEditorReadOnlyContext.Provider>
    </Modal>
  )
}
