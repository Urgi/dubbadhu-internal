/** Lesson editor form for `repetition` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  AudioExposureOromoField,
  Field,
  audioRefFromWordRow,
  isRealWordBankRowId,
  rowAfaanTextForBankPick,
  rowTranslationText,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderRepetitionEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, exposureWordsForAfaanPicker, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  const rawExamples = Array.isArray(c.examples) ? (c.examples as Record<string, unknown>[]) : []
  const displayExamples =
    rawExamples.length > 0 ? rawExamples : [{ oromo: '', english: '', audio: '' }]

  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const title = String(content.title ?? '').trim()
    const target = String(content.target ?? '').trim()
    const arr = Array.isArray(content.examples)
      ? (content.examples as Record<string, unknown>[])
      : []
    const cleaned = arr
      .map((row) => {
        const oromo = String(row.oromo ?? '').trim()
        const english = String(row.english ?? '').trim()
        const audio = String(row.audio ?? row.audioRef ?? '').trim()
        const wordId = String(row.word_id ?? '').trim().toLowerCase()
        if (!oromo || !english) return null
        const out: Record<string, unknown> = { oromo, english }
        if (audio) out.audio = audio
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(wordId)) {
          out.word_id = wordId
        }
        return out
      })
      .filter((row): row is Record<string, unknown> => row != null)
      .slice(0, 6)
    if (cleaned.length < 1) {
      setJsonError('Add at least one example with both Afaan Oromo and English.')
      return
    }
    saveStructured({
      ...(title ? { title } : {}),
      ...(target ? { target } : {}),
      examples: cleaned,
    })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Up to 6 related examples. Type 2+ letters in Afaan Oromo and pick from the word bank — English and audio fill in automatically. Optional target highlights the pattern word.
      </Text>
      <Field
        label="Title (optional)"
        value={String(c.title ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, title: t }))}
      />
      <Field
        label="Pattern / target word (optional)"
        value={String(c.target ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, target: t }))}
      />
      <Text style={styles.label}>Examples (max 6)</Text>
      {displayExamples.map((row, i) => {
        const linked = Boolean(String(row.word_id ?? '').trim())
        const audioUrl = String(row.audio ?? row.audioRef ?? '').trim()
        return (
          <View key={`rep-${i}`} style={styles.pairCard}>
            <Text style={styles.personTitle}>Example {i + 1}</Text>
            <AudioExposureOromoField
              readOnly={linked}
              lessonHarvested={exposureWordsForAfaanPicker}
              value={String(row.oromo ?? '')}
              onChangeText={(t) => {
                setContent((cur) => {
                  const xs = Array.isArray(cur.examples)
                    ? ([...(cur.examples as Record<string, unknown>[])])
                    : []
                  const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                  return {
                    ...cur,
                    examples: base.map((x, j) => {
                      if (j !== i) return x
                      const next: Record<string, unknown> = {
                        ...x,
                        oromo: t,
                      }
                      delete next.word_id
                      return next
                    }),
                  }
                })
              }}
              onPickFromBank={(picked) => {
                setContent((cur) => {
                  const xs = Array.isArray(cur.examples)
                    ? ([...(cur.examples as Record<string, unknown>[])])
                    : []
                  const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                  const bankId = isRealWordBankRowId(picked) ? picked.id : null
                  const audio = audioRefFromWordRow(picked)
                  return {
                    ...cur,
                    examples: base.map((x, j) => {
                      if (j !== i) return x
                      const next: Record<string, unknown> = {
                        ...x,
                        oromo: rowAfaanTextForBankPick(picked),
                        english: rowTranslationText(picked),
                        word_id: bankId,
                      }
                      if (!bankId) delete next.word_id
                      if (audio) next.audio = audio
                      else delete next.audio
                      delete next.audioRef
                      return next
                    }),
                  }
                })
              }}
            />
            <Field
              label="English"
              value={String(row.english ?? '')}
              editable={!linked}
              onChangeText={(t) => {
                setContent((cur) => {
                  const xs = Array.isArray(cur.examples)
                    ? ([...(cur.examples as Record<string, unknown>[])])
                    : []
                  const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                  return {
                    ...cur,
                    examples: base.map((x, j) => (j === i ? { ...x, english: t } : x)),
                  }
                })
              }}
            />
            {linked ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.matchRightPreviewLabel}>
                  Audio
                </Text>
                <Text style={styles.matchRightPreview} numberOfLines={2}>
                  {audioUrl || '— (no audio on this word bank row yet)'}
                </Text>
              </View>
            ) : (
              <Field
                label="Audio URL"
                value={audioUrl}
                onChangeText={(t) => {
                  setContent((cur) => {
                    const xs = Array.isArray(cur.examples)
                      ? ([...(cur.examples as Record<string, unknown>[])])
                      : []
                    const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                    return {
                      ...cur,
                      examples: base.map((x, j) => (j === i ? { ...x, audio: t } : x)),
                    }
                  })
                }}
              />
            )}
            <Pressable
              style={styles.changeWordBtn}
              onPress={() => {
                setContent((cur) => {
                  const xs = Array.isArray(cur.examples)
                    ? ([...(cur.examples as Record<string, unknown>[])])
                    : []
                  const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                  return {
                    ...cur,
                    examples: base.map((x, j) => {
                      if (j !== i) return x
                      return { oromo: '', english: '', audio: '' }
                    }),
                  }
                })
              }}
            >
              <Text style={styles.changeWordBtnText}>Clear / change word</Text>
            </Pressable>
            <Pressable
              style={styles.removeBtn}
              onPress={() => {
                setContent((cur) => {
                  const xs = Array.isArray(cur.examples)
                    ? ([...(cur.examples as Record<string, unknown>[])])
                    : []
                  const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
                  if (base.length <= 1) {
                    return { ...cur, examples: [{ oromo: '', english: '', audio: '' }] }
                  }
                  return { ...cur, examples: base.filter((_, j) => j !== i) }
                })
              }}
            >
              <Text style={styles.removeBtnText}>Remove example</Text>
            </Pressable>
          </View>
        )
      })}
      {displayExamples.length < 6 ? (
        <Pressable
          style={styles.addBtn}
          onPress={() => {
            setContent((cur) => {
              const xs = Array.isArray(cur.examples)
                ? ([...(cur.examples as Record<string, unknown>[])])
                : []
              const base = xs.length > 0 ? xs : [{ oromo: '', english: '', audio: '' }]
              if (base.length >= 6) return cur
              return {
                ...cur,
                examples: [...base, { oromo: '', english: '', audio: '' }],
              }
            })
          }}
        >
          <Text style={styles.addBtnText}>+ Add example</Text>
        </Pressable>
      ) : (
        <Text style={styles.hint}>Maximum of 6 examples.</Text>
      )}
    </View>
  )
}
