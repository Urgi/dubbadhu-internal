/** Lesson editor form for `speakingPractice` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { normalizeSpeakingPracticeContentForSave } from '../../../lib/lessonEditor'
import {
  AudioExposureOromoField,
  Field,
  isRealWordBankRowId,
  rowAfaanTextForBankPick,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderSpeakingPracticeEditor(ctx: ScreenEditorContext): ReactNode {
  const { audioExposureSpeakingLinkOptions, c, draftRef, exposureWordsForAfaanPicker, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  const rawPhrases = Array.isArray(c.phrases) ? (c.phrases as Record<string, unknown>[]) : []
  const legacySingle =
    rawPhrases.length === 0 &&
    (String(c.word ?? '').trim() ||
      String(c.prompt ?? '').trim() ||
      String(c.word_id ?? '').trim() ||
      String(c.speakingDraftTokenId ?? '').trim())
      ? [
          {
            word: c.word,
            prompt: c.prompt,
            tip: c.tip,
            word_id: c.word_id,
            speakingDraftTokenId: c.speakingDraftTokenId,
          } as Record<string, unknown>,
        ]
      : []
  const displayPhrases =
    rawPhrases.length > 0
      ? rawPhrases
      : legacySingle.length > 0
        ? legacySingle
        : [{ word: '', prompt: '' }]

  const updatePhrase = (index: number, patch: (row: Record<string, unknown>) => Record<string, unknown>) => {
    setContent((cur) => {
      const xs = Array.isArray(cur.phrases)
        ? ([...(cur.phrases as Record<string, unknown>[])])
        : displayPhrases.map((p) => ({ ...p }))
      const base = xs.length > 0 ? xs : [{ word: '', prompt: '' }]
      return {
        phrases: base.map((x, j) => (j === index ? patch({ ...x }) : x)),
      }
    })
  }

  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const normalized = normalizeSpeakingPracticeContentForSave(content)
    const phrases = Array.isArray(normalized.phrases) ? normalized.phrases : []
    if (phrases.length < 1) {
      setJsonError('Add at least one phrase (Afaan Oromo text, word bank pick, or exposure link).')
      return
    }
    setJsonError('')
    saveStructured(normalized)
  }
  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Add one or more phrases. Learners practice them one after another on this screen (same as stacking
        Speaking practice steps). Type 2+ letters and pick from the word bank, or link an Audio exposure word.
        Max {10}.
      </Text>
      <Text style={styles.label}>Phrases</Text>
      {displayPhrases.map((row, i) => {
        const phraseVal = String(row.word ?? row.prompt ?? '')
        const exposureLinked = Boolean(String(row.speakingDraftTokenId ?? '').trim())
        const bankLinked = Boolean(String(row.word_id ?? '').trim())
        return (
          <View key={`sp-${i}`} style={styles.pairCard}>
            <Text style={styles.personTitle}>Phrase {i + 1}</Text>
            <AudioExposureOromoField
              readOnly={bankLinked || exposureLinked}
              lessonHarvested={exposureWordsForAfaanPicker}
              value={phraseVal}
              onChangeText={(t) => {
                updatePhrase(i, () => {
                  const next: Record<string, unknown> = {
                    word: t,
                    prompt: t,
                    tip: '',
                  }
                  return next
                })
              }}
              onPickFromBank={(picked) => {
                updatePhrase(i, (cur) => {
                  const bankId = isRealWordBankRowId(picked) ? picked.id : null
                  const next: Record<string, unknown> = {
                    ...cur,
                    word_id: bankId,
                    word: rowAfaanTextForBankPick(picked),
                    prompt: rowAfaanTextForBankPick(picked),
                  }
                  if (!bankId) delete next.word_id
                  delete next.speakingDraftTokenId
                  return next
                })
              }}
            />
            {audioExposureSpeakingLinkOptions.length ? (
              <View style={{ marginTop: 10 }}>
                <Text style={[styles.hint, { marginBottom: 8 }]}>
                  Or link to an Audio exposure word in this lesson.
                </Text>
                {audioExposureSpeakingLinkOptions.map((opt) => (
                  <Pressable
                    key={`${i}-${opt.draftTokenId}`}
                    style={styles.quizCorrectChoice}
                    onPress={() => {
                      updatePhrase(i, () => {
                        const next: Record<string, unknown> = {
                          word: opt.afaan,
                          prompt: opt.afaan,
                          speakingDraftTokenId: opt.draftTokenId,
                          tip: '',
                        }
                        return next
                      })
                    }}
                  >
                    <Text style={styles.quizCorrectChoiceText}>
                      {opt.afaan}
                      {opt.screenIndex ? ` · exposure screen #${opt.screenIndex}` : ''}
                    </Text>
                    {opt.english.trim() ? (
                      <Text style={styles.quizCorrectChoiceSub}>{opt.english.trim()}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              style={styles.changeWordBtn}
              onPress={() => {
                updatePhrase(i, () => ({ word: '', prompt: '', tip: '' }))
              }}
            >
              <Text style={styles.changeWordBtnText}>Clear</Text>
            </Pressable>
            <Field
              label="Tip (optional)"
              value={String(row.tip ?? '')}
              onChangeText={(t) => {
                updatePhrase(i, (cur) => ({ ...cur, tip: t }))
              }}
            />
            {displayPhrases.length > 1 ? (
              <Pressable
                style={styles.removeBtn}
                onPress={() => {
                  setContent((cur) => {
                    const xs = Array.isArray(cur.phrases)
                      ? ([...(cur.phrases as Record<string, unknown>[])])
                      : displayPhrases.map((p) => ({ ...p }))
                    return { phrases: xs.filter((_, j) => j !== i) }
                  })
                }}
              >
                <Text style={styles.removeBtnText}>Remove phrase</Text>
              </Pressable>
            ) : null}
          </View>
        )
      })}
      {displayPhrases.length < 10 ? (
        <Pressable
          style={styles.addBtn}
          onPress={() => {
            setContent((cur) => {
              const xs = Array.isArray(cur.phrases)
                ? ([...(cur.phrases as Record<string, unknown>[])])
                : displayPhrases.map((p) => ({ ...p }))
              return { phrases: [...xs, { word: '', prompt: '' }] }
            })
          }}
        >
          <Text style={styles.addBtnText}>+ Add phrase</Text>
        </Pressable>
      ) : null}
    </View>
  )
}
