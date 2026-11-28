/** Lesson editor form for `patternPractice` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import {
  Modal,
  Pressable,
  Text,
  View,
} from 'react-native'
import {
  Field,
  WordBankPicker,
  patternOptionString,
  rowAfaanTextForBankPick,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderPatternPracticeEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, patternCorrectOpen, primaryScreenSaveRef, saveStructured, setContent, setJsonError, setPatternCorrectOpen } = ctx
  let exercises = (c.exercises as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(exercises) || exercises.length === 0) {
    exercises = [{ prompt: '', options: [], correctSuffix: '' }]
  }
  const ex0 = { ...(exercises[0] as Record<string, unknown>) }
  const optionsRaw = Array.isArray(ex0.options) ? (ex0.options as unknown[]) : []
  const options = optionsRaw.map(patternOptionString).filter(Boolean)
  const correctSuffix = String(ex0.correctSuffix ?? '').trim()
  const correctOk = Boolean(correctSuffix && options.includes(correctSuffix))

  const patchEx0 = (fn: (e0: Record<string, unknown>) => Record<string, unknown>) => {
    setContent((cur) => {
      const ex = (cur.exercises as Record<string, unknown>[]) ?? []
      const e0 = { ...(ex[0] ?? { prompt: '', options: [], correctSuffix: '' }) }
      return { ...cur, exercises: [fn(e0), ...ex.slice(1)] }
    })
  }

  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = { ...(d.content as Record<string, unknown>) }
    const ex = (content.exercises as Record<string, unknown>[] | undefined) ?? []
    const e0pat = ex[0] as Record<string, unknown> | undefined
    const opts = Array.isArray(e0pat?.options)
      ? (e0pat.options as unknown[]).map(patternOptionString).filter(Boolean)
      : []
    if (opts.length < 2) {
      setJsonError('Pattern practice needs at least 2 options.')
      return
    }
    const cs = String(e0pat?.correctSuffix ?? '').trim()
    if (!opts.includes(cs)) {
      setJsonError('Correct answer must be one of the options.')
      return
    }
    saveStructured(content)
  }

  return (
    <View style={styles.form}>
      <Field label="Prompt" value={String(ex0.prompt ?? '')} allowMultiline onChangeText={(t) => patchEx0((e0) => ({ ...e0, prompt: t }))} />
      <Text style={styles.label}>Options (pick from word bank)</Text>
      <Text style={styles.hint}>Same flow as quiz options, but stored as plain text (no audio).</Text>
      {options.map((opt, i) => (
        <View key={`${opt}-${i}`} style={styles.quizOptionCard}>
          <View style={styles.quizOptionTextCol}>
            <Text style={styles.quizOptionTop}>{opt}</Text>
          </View>
          <Pressable
            style={styles.quizOptionRemoveBtn}
            onPress={() => {
              patchEx0((e0) => {
                const optsRaw = Array.isArray(e0.options) ? (e0.options as unknown[]) : []
                const opts = optsRaw.map(patternOptionString).filter(Boolean)
                const nextOpts = opts.filter((_, j) => j !== i)
                let nextCorrect = String(e0.correctSuffix ?? '').trim()
                if (!nextOpts.includes(nextCorrect)) nextCorrect = nextOpts[0] ?? ''
                return { ...e0, options: nextOpts, correctSuffix: nextCorrect }
              })
            }}
          >
            <Text style={styles.quizOptionRemoveText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <WordBankPicker
        label="Add option (Oromo)"
        value={null}
        onPick={(row) => {
          const text = rowAfaanTextForBankPick(row)
          if (!text) return
          patchEx0((e0) => {
            const optsRaw = Array.isArray(e0.options) ? (e0.options as unknown[]) : []
            const opts = optsRaw.map(patternOptionString).filter(Boolean)
            if (opts.includes(text)) return e0
            const nextOpts = [...opts, text]
            let nextCorrect = String(e0.correctSuffix ?? '').trim()
            if (!nextCorrect || !nextOpts.includes(nextCorrect)) nextCorrect = nextOpts[0] ?? ''
            return { ...e0, options: nextOpts, correctSuffix: nextCorrect }
          })
        }}
        placeholder="Search Oromo word…"
      />
      <Pressable
        style={styles.quizCorrectBtn}
        onPress={() => setPatternCorrectOpen(true)}
        disabled={options.length < 2}
      >
        <Text style={styles.quizCorrectBtnLabel}>Correct answer</Text>
        <Text style={styles.quizCorrectBtnValue}>{correctOk ? correctSuffix : options.length >= 2 ? 'Tap to choose' : '—'}</Text>
      </Pressable>
      <Field
        label="Explanation (optional)"
        value={String(ex0.explanation ?? '')}
        allowMultiline
        onChangeText={(t) => patchEx0((e0) => ({ ...e0, explanation: t }))}
      />

      <Modal visible={patternCorrectOpen} transparent animationType="fade" onRequestClose={() => setPatternCorrectOpen(false)}>
        <Pressable style={styles.quizCorrectOverlay} onPress={() => setPatternCorrectOpen(false)}>
          <Pressable style={styles.quizCorrectSheet} onPress={() => {}}>
            <Text style={styles.personTitle}>Select correct answer</Text>
            {options.length < 2 ? (
              <Text style={styles.hint}>Add at least 2 options first.</Text>
            ) : (
              options.map((opt, idx) => (
                <Pressable
                  key={`${idx}-${opt}`}
                  style={styles.quizCorrectChoice}
                  onPress={() => {
                    patchEx0((e0) => {
                      const optsRaw = Array.isArray(e0.options) ? (e0.options as unknown[]) : []
                      const opts = optsRaw.map(patternOptionString).filter(Boolean)
                      return { ...e0, options: opts, correctSuffix: opt }
                    })
                    setPatternCorrectOpen(false)
                  }}
                >
                  <Text style={styles.quizCorrectChoiceText}>
                    {opt === correctSuffix ? '✓ ' : ''}
                    {opt}
                  </Text>
                </Pressable>
              ))
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
