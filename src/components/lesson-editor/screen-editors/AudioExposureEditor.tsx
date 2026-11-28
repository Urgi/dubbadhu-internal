/** Lesson editor form for `audioExposure` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { exposureMeaningWarning, exposurePhraseWarning } from '../../../lib/learnerTextLimits'
import {
  Alert,
  Linking,
  Pressable,
  Text,
  View,
} from 'react-native'
import type { LessonScreen } from '../../../lib/lessonEditor'
import {
  findAudioExposureWordsBlockingLessonSave,
  formatAudioExposureDraftGapsForLessonSave,
  normalizeAudioExposureContentForEdit,
  newDraftTokenId,
} from '../../../lib/lessonEditor'
import {
  AudioExposureOromoField,
  Field,
  applyWordBankUrlsToExposureWord,
  isRealWordBankRowId,
  isUuidLike,
  resolveAudioExposureWordsAgainstBank,
  rowAfaanTextForBankPick,
  rowTranslationText,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderAudioExposureEditor(ctx: ScreenEditorContext): ReactNode {
  const { allowJsonEditing, audioExposureBankSaveBusyRef, audioExposureOromoTypingIgnoreUntilRef, c, draftRef, exposureWordsForAfaanPicker, lessonSeries, primaryScreenSaveRef, promptTranslationConflict, reportScreenSaveError, saveStructured, setContent, setJsonError, setScreenSaveBusy, setTranslationConflict } = ctx
  let words = (c.words as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(words)) words = []
  primaryScreenSaveRef.current = () => {
    void (async () => {
      if (audioExposureBankSaveBusyRef.current) {
        Alert.alert('Save in progress', 'Please wait for the current save to finish.')
        return
      }
      audioExposureBankSaveBusyRef.current = true
      setScreenSaveBusy(true)
      try {
        setJsonError('')
        const current = draftRef.current
        if (!current) return
        const c2 = normalizeAudioExposureContentForEdit(
          current.content as Record<string, unknown>,
        )
        const ws = (c2.words as Record<string, unknown>[] | undefined) ?? []
        if (!Array.isArray(ws) || ws.length < 1) {
          reportScreenSaveError(
            allowJsonEditing
              ? 'Audio exposure needs at least one word. Add a word or use Apply JSON & close.'
              : 'Audio exposure needs at least one word. Add a word first.',
          )
          return
        }
        const contentSeries = String(c2.series ?? '').trim()
        const runBankCompare = Boolean((lessonSeries ?? '').trim() || contentSeries)
        const resolvedWords = runBankCompare
          ? await resolveAudioExposureWordsAgainstBank(
              ws as Record<string, unknown>[],
              lessonSeries,
              contentSeries || null,
              promptTranslationConflict,
            )
          : (ws as Record<string, unknown>[])
        const gaps = findAudioExposureWordsBlockingLessonSave([
          { type: 'audioExposure', content: { ...c2, words: resolvedWords } } as LessonScreen,
        ])
        if (gaps.length > 0) {
          reportScreenSaveError(formatAudioExposureDraftGapsForLessonSave(gaps))
          return
        }
        setTranslationConflict(null)
        saveStructured({ ...c2, words: resolvedWords })
      } catch (e) {
        setTranslationConflict(null)
        const msg = e instanceof Error ? e.message : String(e)
        reportScreenSaveError(msg)
      } finally {
        audioExposureBankSaveBusyRef.current = false
        setScreenSaveBusy(false)
      }
    })()
  }
  return (
    <View style={styles.form}>
      {words.length === 0 ? (
        <Text style={styles.hint}>
          {allowJsonEditing
            ? 'No words yet. Remove the last word to start fresh, then use + Add word. Save requires at least one word (or use Apply JSON & close).'
            : 'No words yet. Remove the last word to start fresh, then use + Add word. Save requires at least one word.'}
        </Text>
      ) : null}
      {words.length ? (
        <Text style={styles.hint}>
          Type Afaan Oromo and translation for each row. Set “Said by” per word (shown under the gloss in the
          learner app). Linking from search is optional while you draft the series — Approve Series adds new
          phrases to the voice bank and recording queue. If a phrase already exists, tap a search match to attach
          its word_id early.
        </Text>
      ) : null}
      {words.map((w, i) => (
        <View key={i} style={styles.pairCard}>
          <Text style={styles.personTitle}>Word {i + 1}</Text>
          <AudioExposureOromoField
            readOnly={Boolean(w.word_id)}
            lessonHarvested={exposureWordsForAfaanPicker}
            value={String(w.word ?? '')}
            onChangeText={(t) => {
              const ignoreUntil = audioExposureOromoTypingIgnoreUntilRef.current.get(i) ?? 0
              if (Date.now() < ignoreUntil) return
              setContent((cur) => {
                const ws = (cur.words as Record<string, unknown>[]) ?? []
                const next = ws.map((x, j) => {
                  if (j !== i) return x
                  const prev = x as Record<string, unknown>
                  const wid = String(prev.word_id ?? '').trim()
                  if (wid && isUuidLike(wid)) {
                    return prev
                  }
                  const nx: Record<string, unknown> = { ...prev, word: t }
                  delete nx.oromo
                  delete nx.english
                  return nx
                })
                return { ...cur, words: next }
              })
            }}
            onPickFromBank={(row) => {
              audioExposureOromoTypingIgnoreUntilRef.current.set(i, Date.now() + 500)
              setContent((cur) => {
                const ws = (cur.words as Record<string, unknown>[]) ?? []
                const bankId = isRealWordBankRowId(row) ? row.id : null
                const next = ws.map((x, j) => {
                  if (j !== i) return x
                  const item: Record<string, unknown> = {
                    ...(x as Record<string, unknown>),
                    word_id: bankId,
                    word: rowAfaanTextForBankPick(row),
                    translation: rowTranslationText(row),
                  }
                  delete item.oromo
                  delete item.english
                  if (!bankId) delete item.word_id
                  applyWordBankUrlsToExposureWord(item, row)
                  return item
                })
                return { ...cur, words: next }
              })
            }}
          />
          {exposurePhraseWarning(String(w.word ?? '')) ? (
            <Text style={styles.lengthWarn}>{exposurePhraseWarning(String(w.word ?? ''))}</Text>
          ) : null}
          <Field
            label="Translation"
            value={String(w.translation ?? w.english ?? '')}
            editable
            onChangeText={(t) => {
              setContent((cur) => {
                const ws = (cur.words as Record<string, unknown>[]) ?? []
                const next = ws.map((x, j) => {
                  if (j !== i) return x
                  const nx: Record<string, unknown> = { ...(x as Record<string, unknown>), translation: t }
                  delete nx.english
                  return nx
                })
                return { ...cur, words: next }
              })
            }}
          />
          {exposureMeaningWarning(String(w.translation ?? w.english ?? '')) ? (
            <Text style={styles.lengthWarn}>
              {exposureMeaningWarning(String(w.translation ?? w.english ?? ''))}
            </Text>
          ) : null}
          <Field
            label="Said by (speaker name)"
            value={String(w.saidBy ?? '')}
            onChangeText={(t) => {
              setContent((cur) => {
                const ws = (cur.words as Record<string, unknown>[]) ?? []
                const next = ws.map((x, j) => {
                  if (j !== i) return x
                  const nx: Record<string, unknown> = { ...(x as Record<string, unknown>) }
                  const v = t.trim()
                  if (v) nx.saidBy = t
                  else delete nx.saidBy
                  return nx
                })
                return { ...cur, words: next }
              })
            }}
          />
          <Pressable
            style={styles.removeBtn}
            onPress={() => {
              setContent((cur) => {
                const ws = (cur.words as Record<string, unknown>[]) ?? []
                return { ...cur, words: ws.filter((_, j) => j !== i) }
              })
            }}
          >
            <Text style={styles.removeBtnText}>Remove word</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.addBtn}
        onPress={() =>
          setContent((cur) => {
            const ws = (cur.words as Record<string, unknown>[]) ?? []
            return {
              ...cur,
              words: [...ws, { word: '', translation: '', draftTokenId: newDraftTokenId() }],
            }
          })
        }
      >
        <Text style={styles.addBtnText}>+ Add word</Text>
      </Pressable>
    </View>
  )
}
