/** Lesson editor form for `repetitionPractice` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Switch, Text, View } from 'react-native'
import {
  AudioExposureOromoField,
  Field,
  Row,
  audioRefFromWordRow,
  rowAfaanTextForBankPick,
  rowTranslationText,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderRepetitionPracticeEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, exposureWordsForAfaanPicker, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  const emptyPair = () => ({
    base: { oromo: '', english: '', audio: '' },
    answer: { oromo: '', audio: '' },
    sharedStem: '',
    addedPart: '',
  })
  const rawPairs = Array.isArray(c.pairs) ? (c.pairs as Record<string, unknown>[]) : []
  const displayPairs = Array.from({ length: 3 }, (_, index) => rawPairs[index] ?? emptyPair())

  const updatePair = (
    pairIndex: number,
    updater: (pair: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    setContent((cur) => {
      const current = Array.isArray(cur.pairs)
        ? ([...(cur.pairs as Record<string, unknown>[])])
        : []
      const next = Array.from({ length: 3 }, (_, index) => current[index] ?? emptyPair())
      next[pairIndex] = updater(next[pairIndex])
      return { ...cur, pairs: next }
    })
  }

  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const pairs = Array.isArray(content.pairs)
      ? (content.pairs as Record<string, unknown>[])
      : []
    if (pairs.length !== 3) {
      setJsonError('Pattern practice requires exactly three pairs.')
      return
    }
    const cleaned = pairs.map((pair) => {
      const base =
        pair.base && typeof pair.base === 'object' && !Array.isArray(pair.base)
          ? (pair.base as Record<string, unknown>)
          : {}
      const answer =
        pair.answer && typeof pair.answer === 'object' && !Array.isArray(pair.answer)
          ? (pair.answer as Record<string, unknown>)
          : {}
      return {
        base: {
          oromo: String(base.oromo ?? '').trim(),
          english: String(base.english ?? '').trim(),
          audio: String(base.audio ?? '').trim(),
          word_id: String(base.word_id ?? '').trim().toLowerCase(),
        },
        answer: {
          oromo: String(answer.oromo ?? '').trim(),
          audio: String(answer.audio ?? '').trim(),
          word_id: String(answer.word_id ?? '').trim().toLowerCase(),
        },
        sharedStem: String(pair.sharedStem ?? '').trim(),
        addedPart: String(pair.addedPart ?? '').trim(),
      }
    })
    const incomplete = cleaned.some(
      (pair) =>
        !pair.base.oromo ||
        !pair.base.english ||
        !pair.answer.oromo,
    )
    if (incomplete) {
      setJsonError(
        'Each pair needs a base Oromo word, base English meaning, and answer word. Missing audio is queued for voice recording when the series syncs.',
      )
      return
    }
    saveStructured({
      ...(String(content.title ?? '').trim()
        ? { title: String(content.title ?? '').trim() }
        : {}),
      ...(String(content.instruction ?? '').trim()
        ? { instruction: String(content.instruction ?? '').trim() }
        : {}),
      ...(content.onePairAtATime === true ? { onePairAtATime: true } : {}),
      pairs: cleaned,
    })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Exactly three Oromo pairs. Learners hear the first five words in order, then record the
        missing sixth word and compare it with the model. Words without audio are queued for
        voice recording when the series syncs.
      </Text>
      <Field
        label="Title (optional)"
        value={String(c.title ?? '')}
        onChangeText={(title) => setContent((cur) => ({ ...cur, title }))}
      />
      <Field
        label="Instruction (optional)"
        value={String(c.instruction ?? '')}
        onChangeText={(instruction) => setContent((cur) => ({ ...cur, instruction }))}
      />
      <Row label="One pair at a time (more room)">
        <Switch
          value={c.onePairAtATime === true}
          onValueChange={(on) =>
            setContent((cur) => {
              if (!on) {
                const next = { ...cur }
                delete next.onePairAtATime
                return next
              }
              return { ...cur, onePairAtATime: true }
            })
          }
          trackColor={{ false: '#3f3f46', true: '#E8870A' }}
          thumbColor="#fff"
        />
      </Row>
      <Text style={styles.hint}>
        Off (default): all three pairs stacked. On: each pair fills the screen; bottom arrow
        advances to the next pair.
      </Text>
      {displayPairs.map((pair, pairIndex) => {
        const base =
          pair.base && typeof pair.base === 'object' && !Array.isArray(pair.base)
            ? (pair.base as Record<string, unknown>)
            : {}
        const answer =
          pair.answer && typeof pair.answer === 'object' && !Array.isArray(pair.answer)
            ? (pair.answer as Record<string, unknown>)
            : {}
        const updateWord = (
          side: 'base' | 'answer',
          key: 'oromo' | 'english' | 'audio',
          value: string,
        ) => {
          updatePair(pairIndex, (current) => {
            const word =
              current[side] &&
              typeof current[side] === 'object' &&
              !Array.isArray(current[side])
                ? (current[side] as Record<string, unknown>)
                : {}
            if (key === 'oromo') {
              const next: Record<string, unknown> = { ...word, oromo: value }
              delete next.word_id
              delete next.audio
              delete next.audioRef
              return { ...current, [side]: next }
            }
            return { ...current, [side]: { ...word, [key]: value } }
          })
        }
        return (
          <View key={`pattern-pair-${pairIndex}`} style={styles.pairCard}>
            <Text style={styles.personTitle}>
              Pair {pairIndex + 1}{pairIndex === 2 ? ' · learner completes this pair' : ''}
            </Text>
            <Text style={styles.label}>Base Afaan Oromo</Text>
            <AudioExposureOromoField
              readOnly={false}
              lessonHarvested={exposureWordsForAfaanPicker}
              value={String(base.oromo ?? '')}
              onChangeText={(value) => updateWord('base', 'oromo', value)}
              onPickFromBank={(picked) => {
                const audio = audioRefFromWordRow(picked)
                updatePair(pairIndex, (current) => ({
                  ...current,
                  base: {
                    oromo: rowAfaanTextForBankPick(picked),
                    english: rowTranslationText(picked),
                    word_id: picked.id,
                    ...(audio ? { audio } : {}),
                  },
                }))
              }}
            />
            <Field
              label="Base English meaning"
              value={String(base.english ?? '')}
              onChangeText={(value) => updateWord('base', 'english', value)}
            />
            <Field
              label="Base audio URL"
              value={String(base.audio ?? '')}
              onChangeText={(value) => updateWord('base', 'audio', value)}
            />
            <Text style={styles.label}>Paired / answer Afaan Oromo</Text>
            <AudioExposureOromoField
              readOnly={false}
              lessonHarvested={exposureWordsForAfaanPicker}
              value={String(answer.oromo ?? '')}
              onChangeText={(value) => updateWord('answer', 'oromo', value)}
              onPickFromBank={(picked) => {
                const audio = audioRefFromWordRow(picked)
                updatePair(pairIndex, (current) => ({
                  ...current,
                  answer: {
                    oromo: rowAfaanTextForBankPick(picked),
                    word_id: picked.id,
                    ...(audio ? { audio } : {}),
                  },
                }))
              }}
            />
            <Field
              label="Answer audio URL"
              value={String(answer.audio ?? '')}
              onChangeText={(value) => updateWord('answer', 'audio', value)}
            />
            <Field
              label="Shared stem (optional highlight)"
              value={String(pair.sharedStem ?? '')}
              onChangeText={(sharedStem) =>
                updatePair(pairIndex, (current) => ({ ...current, sharedStem }))
              }
            />
            <Field
              label="Added part (optional highlight)"
              value={String(pair.addedPart ?? '')}
              onChangeText={(addedPart) =>
                updatePair(pairIndex, (current) => ({ ...current, addedPart }))
              }
            />
          </View>
        )
      })}
    </View>
  )
}
