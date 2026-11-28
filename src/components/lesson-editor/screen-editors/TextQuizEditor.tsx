/** Lesson editor form for `textQuiz` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { AdminTextInput } from '../../AdminTextInput'
import {
  Field,
  ensureTextQuizQuestionsArray,
  patchTextQuizQuestionInContent,
  styles,
  textQuizOptionsFromQuestion,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderTextQuizEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, isReadOnly, primaryScreenSaveRef, saveStructured, setContent, setJsonError, setTextQuizExpandedQuestionIdx, textQuizExpandedQuestionIdx } = ctx
  const questions = ensureTextQuizQuestionsArray(c)
  const expandIdx = Math.max(0, Math.min(textQuizExpandedQuestionIdx, questions.length - 1))

  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const rows = ensureTextQuizQuestionsArray(d.content as Record<string, unknown>)
    const cleaned = rows.map((q) => ({
      question: String(q.question ?? '').trim(),
      options: textQuizOptionsFromQuestion(q)
        .map((o) => o.trim())
        .filter(Boolean),
      correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0,
      explanation: String(q.explanation ?? '').trim(),
    }))
    const badIdx = cleaned.findIndex((q) => !q.question || q.options.length < 2)
    if (badIdx >= 0) {
      setJsonError(
        `Question ${badIdx + 1}: add question text and at least two non-empty options.`,
      )
      setTextQuizExpandedQuestionIdx(badIdx)
      return
    }
    setJsonError('')
    saveStructured({
      questions: cleaned.map((q) => ({
        question: q.question,
        options: q.options,
        correctAnswer: Math.max(0, Math.min(q.correctAnswer, q.options.length - 1)),
        ...(q.explanation ? { explanation: q.explanation } : {}),
      })),
    })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Type the question and its options, then tap the circle next to the option that is
        correct. No word bank or audio — plain text only.
      </Text>
      {questions.map((q, qIdx) => {
        const expanded = qIdx === expandIdx
        const options = textQuizOptionsFromQuestion(q)
        const correctIdx = typeof q.correctAnswer === 'number' ? q.correctAnswer : 0
        const qPreview = String(q.question ?? '').trim()
        const summaryLine =
          (qPreview.length > 72 ? `${qPreview.slice(0, 72)}…` : qPreview) ||
          '(no question text yet)'
        const filledCount = options.filter((o) => o.trim()).length
        return (
          <View key={`text-quiz-q-${qIdx}`} style={styles.quizQuestionShell}>
            <View style={styles.quizQuestionHeader}>
              <Pressable
                style={styles.quizQuestionHeaderTap}
                onPress={() => setTextQuizExpandedQuestionIdx(qIdx)}
              >
                <View style={styles.quizQuestionHeaderMeta}>
                  <View style={styles.quizQuestionTitleRow}>
                    <Text style={styles.quizQuestionLabel}>Question {qIdx + 1}</Text>
                    <Text style={styles.quizQuestionChevron}>{expanded ? '▾' : '▸'}</Text>
                  </View>
                  {!expanded ? (
                    <Text style={styles.quizQuestionSummary} numberOfLines={2}>
                      {summaryLine} · {filledCount} option{filledCount === 1 ? '' : 's'}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {questions.length > 1 ? (
                <Pressable
                  style={styles.quizQuestionRemoveHeader}
                  onPress={() => {
                    setContent((cur) => {
                      const qs = ensureTextQuizQuestionsArray(cur)
                      if (qs.length <= 1) return cur
                      return { ...cur, questions: qs.filter((_, j) => j !== qIdx) }
                    })
                    setTextQuizExpandedQuestionIdx((prev) =>
                      qIdx <= prev ? Math.max(0, prev - 1) : prev,
                    )
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
                  allowMultiline
                  onChangeText={(t) =>
                    setContent((cur) =>
                      patchTextQuizQuestionInContent(cur, qIdx, (row) => ({
                        ...row,
                        question: t,
                      })),
                    )
                  }
                />
                <Text style={styles.label}>Options</Text>
                <Text style={styles.hint}>
                  Tap a circle to mark the correct answer. At least two options are required.
                </Text>
                {options.map((opt, i) => (
                  <View key={`text-quiz-opt-${qIdx}-${i}`} style={styles.textQuizOptionRow}>
                    <Pressable
                      style={styles.textQuizRadioTap}
                      hitSlop={8}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: i === correctIdx }}
                      accessibilityLabel={`Mark option ${i + 1} correct`}
                      onPress={() =>
                        setContent((cur) =>
                          patchTextQuizQuestionInContent(cur, qIdx, (row) => ({
                            ...row,
                            correctAnswer: i,
                          })),
                        )
                      }
                    >
                      <View
                        style={[
                          styles.textQuizRadio,
                          i === correctIdx && styles.textQuizRadioOn,
                        ]}
                      >
                        {i === correctIdx ? <View style={styles.textQuizRadioDot} /> : null}
                      </View>
                    </Pressable>
                    <AdminTextInput
                      style={[
                        styles.input,
                        styles.textQuizOptionInput,
                        i === correctIdx && styles.textQuizOptionInputOn,
                      ]}
                      value={opt}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor="#52525b"
                      editable={!isReadOnly}
                      onChangeText={(t) =>
                        setContent((cur) =>
                          patchTextQuizQuestionInContent(cur, qIdx, (row) => {
                            const next = textQuizOptionsFromQuestion(row).map((x, j) =>
                              j === i ? t : x,
                            )
                            return { ...row, options: next }
                          }),
                        )
                      }
                    />
                    {options.length > 2 ? (
                      <Pressable
                        style={styles.quizOptionRemoveBtn}
                        onPress={() =>
                          setContent((cur) =>
                            patchTextQuizQuestionInContent(cur, qIdx, (row) => {
                              const next = textQuizOptionsFromQuestion(row).filter(
                                (_, j) => j !== i,
                              )
                              const prevCorrect =
                                typeof row.correctAnswer === 'number' ? row.correctAnswer : 0
                              const nextCorrect =
                                prevCorrect === i
                                  ? 0
                                  : prevCorrect > i
                                    ? prevCorrect - 1
                                    : prevCorrect
                              return {
                                ...row,
                                options: next,
                                correctAnswer: Math.max(
                                  0,
                                  Math.min(nextCorrect, next.length - 1),
                                ),
                              }
                            }),
                          )
                        }
                      >
                        <Text style={styles.quizOptionRemoveText}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable
                  style={styles.addBtn}
                  onPress={() =>
                    setContent((cur) =>
                      patchTextQuizQuestionInContent(cur, qIdx, (row) => ({
                        ...row,
                        options: [...textQuizOptionsFromQuestion(row), ''],
                      })),
                    )
                  }
                >
                  <Text style={styles.addBtnText}>+ Add option</Text>
                </Pressable>
                <Field
                  label="Explanation (optional)"
                  value={String(q.explanation ?? '')}
                  allowMultiline
                  onChangeText={(t) =>
                    setContent((cur) =>
                      patchTextQuizQuestionInContent(cur, qIdx, (row) => ({
                        ...row,
                        explanation: t,
                      })),
                    )
                  }
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
            const qs = ensureTextQuizQuestionsArray(cur)
            return {
              ...cur,
              questions: [...qs, { question: '', options: ['', ''], correctAnswer: 0 }],
            }
          })
          setTextQuizExpandedQuestionIdx(questions.length)
        }}
      >
        <Text style={styles.addBtnText}>+ Add question</Text>
      </Pressable>
    </View>
  )
}
