/** Lesson editor form for `quiz` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native'
import {
  Field,
  LessonAndSeriesWordPicker,
  type QuizOptionDraft,
  audioRefFromWordRow,
  ensureQuizQuestionsArray,
  isRealWordBankRowId,
  patchQuizQuestionInContent,
  quizContentWithAudioOptionsFlag,
  quizOptionsDraftFromQ0,
  rowAfaanTextForBankPick,
  rowTranslationText,
  serializeQuizOption,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderQuizEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, exposureWordsForAfaanPicker, primaryScreenSaveRef, quizCorrectModalQ, quizExpandedQuestionIdx, saveStructured, setContent, setQuizCorrectModalQ, setQuizExpandedQuestionIdx, wordBankSeriesLabels } = ctx
  let questions = (c.questions as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(questions) || questions.length === 0) {
    if (typeof c.question === 'string') {
      questions = [
        {
          question: c.question,
          options: Array.isArray(c.options) ? c.options : ['', ''],
          correctAnswer: typeof c.correctAnswer === 'number' ? c.correctAnswer : 0,
        },
      ]
    } else {
      questions = [{ question: '', options: ['', ''], correctAnswer: 0 }]
    }
  }
  const quizExpandIdx = Math.max(0, Math.min(quizExpandedQuestionIdx, questions.length - 1))
  const qForCorrectModal =
    quizCorrectModalQ != null && quizCorrectModalQ >= 0 && quizCorrectModalQ < questions.length
      ? (questions[quizCorrectModalQ] as Record<string, unknown>)
      : null
  const optionsForCorrectModal = qForCorrectModal ? quizOptionsDraftFromQ0(qForCorrectModal) : []
  const correctIdxForModal =
    qForCorrectModal && typeof qForCorrectModal.correctAnswer === 'number' ? qForCorrectModal.correctAnswer : 0

  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    saveStructured(quizContentWithAudioOptionsFlag({ ...(d.content as Record<string, unknown>) }))
  }
  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        One card per learner step. Tap the header to expand or collapse. Add another question when the current
        one is ready.
      </Text>
      {questions.map((qRaw, qIdx) => {
        const q = (qRaw as Record<string, unknown>) ?? {}
        const expanded = qIdx === quizExpandIdx
        const options = quizOptionsDraftFromQ0(q)
        const correctIdx = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0
        const correctLabel =
          options[correctIdx]?.text?.trim() || (options.length ? `Option ${correctIdx + 1}` : '—')
        const qPreview = String(q.question ?? '').trim()
        const summaryLine =
          (qPreview.length > 72 ? `${qPreview.slice(0, 72)}…` : qPreview) || '(no question text yet)'
        return (
          <View key={`quiz-q-${qIdx}`} style={styles.quizQuestionShell}>
            <View style={styles.quizQuestionHeader}>
              <Pressable
                style={styles.quizQuestionHeaderTap}
                onPress={() => {
                  setQuizExpandedQuestionIdx(qIdx)
                  setQuizCorrectModalQ(null)
                }}
              >
                <View style={styles.quizQuestionHeaderMeta}>
                  <View style={styles.quizQuestionTitleRow}>
                    <Text style={styles.quizQuestionLabel}>Question {qIdx + 1}</Text>
                    <Text style={styles.quizQuestionChevron}>{expanded ? '▾' : '▸'}</Text>
                  </View>
                  {!expanded ? (
                    <Text style={styles.quizQuestionSummary} numberOfLines={2}>
                      {summaryLine} · {options.length} option{options.length === 1 ? '' : 's'}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {questions.length > 1 ? (
                <Pressable
                  style={styles.quizQuestionRemoveHeader}
                  onPress={() => {
                    setContent((cur) => {
                      const qs = ensureQuizQuestionsArray(cur)
                      if (qs.length <= 1) return cur
                      const next = qs.filter((_, j) => j !== qIdx)
                      return quizContentWithAudioOptionsFlag({ ...cur, questions: next })
                    })
                    setQuizCorrectModalQ(null)
                    setQuizExpandedQuestionIdx((prev) => {
                      if (qIdx < prev) return Math.max(0, prev - 1)
                      if (qIdx === prev) return Math.max(0, prev - 1)
                      return prev
                    })
                  }}
                >
                  <Text style={styles.quizQuestionRemoveHeaderText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
            {expanded ? (
              <View style={styles.quizQuestionBody}>
                <Field
                  label="Question"
                  value={String(q.question ?? '')}
                  onChangeText={(t) => {
                    setContent((cur) => patchQuizQuestionInContent(cur, qIdx, (row) => ({ ...row, question: t })))
                  }}
                />
                <Text style={styles.label}>Options (pick from word bank)</Text>
                <Text style={styles.hint}>
                  Search the series word bank plus phrases from Audio exposure in this lesson (2+ letters). English
                  shows for context. No free-typed options — pick a row.
                </Text>
                {options.map((opt, i) => (
                  <View key={`${opt.word_id ?? opt.text}-${i}`} style={styles.quizOptionCard}>
                    <View style={styles.quizOptionTextCol}>
                      <Text style={styles.quizOptionTop}>{opt.text}</Text>
                      {opt.english?.trim() ? <Text style={styles.quizOptionSub}>{opt.english.trim()}</Text> : null}
                      {opt.audioRef?.trim() ? (
                        <Text style={styles.quizOptionAudioHint}>Audio from word bank</Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={styles.quizOptionRemoveBtn}
                      onPress={() => {
                        setContent((cur) =>
                          patchQuizQuestionInContent(cur, qIdx, (qFirst) => {
                            const opts = quizOptionsDraftFromQ0(qFirst)
                            const cIdx = typeof qFirst.correctAnswer === 'number' ? qFirst.correctAnswer : 0
                            const nextOpts = opts.filter((_, j) => j !== i).map((x) => ({ ...x }))
                            const serial = nextOpts.map(serializeQuizOption)
                            const nextCorrect = Math.max(0, Math.min(cIdx, Math.max(0, serial.length - 1)))
                            return {
                              ...qFirst,
                              options: serial.length
                                ? serial
                                : [{ text: '', english: '' }, { text: '', english: '' }],
                              correctAnswer: nextCorrect,
                            }
                          }),
                        )
                      }}
                    >
                      <Text style={styles.quizOptionRemoveText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
                <LessonAndSeriesWordPicker
                  label="Add option (Oromo)"
                  seriesLabels={wordBankSeriesLabels}
                  lessonHarvested={exposureWordsForAfaanPicker}
                  hint={
                    !wordBankSeriesLabels.length
                      ? 'Series labels not loaded yet — lesson Audio exposure phrases still appear when they match your search.'
                      : undefined
                  }
                  onPick={(row) => {
                    setContent((cur) =>
                      patchQuizQuestionInContent(cur, qIdx, (qFirst) => {
                        const opts = quizOptionsDraftFromQ0(qFirst)
                        const cIdx = typeof qFirst.correctAnswer === 'number' ? qFirst.correctAnswer : 0
                        const bankId = isRealWordBankRowId(row) ? row.id : null
                        const ar = bankId ? audioRefFromWordRow(row) : undefined
                        const nextOpts: QuizOptionDraft[] = [
                          ...opts,
                          {
                            text: rowAfaanTextForBankPick(row),
                            english: rowTranslationText(row),
                            ...(bankId ? { word_id: bankId } : {}),
                            ...(ar ? { audioRef: ar } : {}),
                          },
                        ]
                        const serial = nextOpts.map(serializeQuizOption)
                        const nextCorrect = Math.max(0, Math.min(cIdx, serial.length - 1))
                        return { ...qFirst, options: serial, correctAnswer: nextCorrect }
                      }),
                    )
                  }}
                />
                <Pressable
                  style={styles.quizCorrectBtn}
                  onPress={() => setQuizCorrectModalQ(qIdx)}
                  disabled={options.length < 2}
                >
                  <Text style={styles.quizCorrectBtnLabel}>Correct answer</Text>
                  <Text style={styles.quizCorrectBtnValue}>{correctLabel}</Text>
                </Pressable>
                <Field
                  label="Explanation (optional)"
                  value={String(q.explanation ?? '')}
                  allowMultiline
                  onChangeText={(t) => {
                    setContent((cur) => patchQuizQuestionInContent(cur, qIdx, (row) => ({ ...row, explanation: t })))
                  }}
                />
              </View>
            ) : null}
          </View>
        )
      })}
      <Pressable
        style={styles.addBtn}
        onPress={() => {
          setContent((cur) => {
            const qs = ensureQuizQuestionsArray(cur)
            const nextQs = [...qs, { question: '', options: ['', ''], correctAnswer: 0 }]
            return quizContentWithAudioOptionsFlag({ ...cur, questions: nextQs })
          })
          setQuizCorrectModalQ(null)
          setQuizExpandedQuestionIdx(questions.length)
        }}
      >
        <Text style={styles.addBtnText}>+ Add question</Text>
      </Pressable>

      <Modal
        visible={quizCorrectModalQ != null && qForCorrectModal != null}
        transparent
        animationType="fade"
        onRequestClose={() => setQuizCorrectModalQ(null)}
      >
        <Pressable style={styles.quizCorrectOverlay} onPress={() => setQuizCorrectModalQ(null)}>
          <Pressable style={styles.quizCorrectSheet} onPress={() => {}}>
            <Text style={styles.personTitle}>Select correct answer</Text>
            {quizCorrectModalQ != null ? (
              <Text style={styles.hint}>Question {quizCorrectModalQ + 1}</Text>
            ) : null}
            {optionsForCorrectModal.length < 2 ? (
              <Text style={styles.hint}>Add at least 2 options first.</Text>
            ) : (
              optionsForCorrectModal.map((opt, idx) => (
                <Pressable
                  key={`${opt.word_id ?? opt.text}-${idx}`}
                  style={styles.quizCorrectChoice}
                  onPress={() => {
                    const qi = quizCorrectModalQ
                    if (qi == null) return
                    setContent((cur) => patchQuizQuestionInContent(cur, qi, (row) => ({ ...row, correctAnswer: idx })))
                    setQuizCorrectModalQ(null)
                  }}
                >
                  <Text style={styles.quizCorrectChoiceText}>
                    {idx === correctIdxForModal ? '✓ ' : ''}
                    {opt.text}
                  </Text>
                  {opt.english?.trim() ? (
                    <Text style={styles.quizCorrectChoiceSub}>{opt.english.trim()}</Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
