/** Lesson editor form for `word-breakdown` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { AdminTextInput } from '../../AdminTextInput'
import {
  Field,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderWordBreakdownEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  const rawWords = Array.isArray(c.words) ? (c.words as Record<string, unknown>[]) : []
  const displayWords =
    rawWords.length > 0 ? rawWords : [{ word: '', translation: '' }]

  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const original = String(content.original ?? '').trim()
    if (!original) {
      setJsonError('Word breakdown needs the full phrase (original).')
      return
    }
    const arr = Array.isArray(content.words) ? (content.words as Record<string, unknown>[]) : []
    const cleaned = arr
      .map((row) => ({
        word: String(row.word ?? '').trim(),
        translation: String(row.translation ?? '').trim(),
      }))
      .filter((row) => row.word && row.translation)
    if (cleaned.length < 1) {
      setJsonError('Add at least one row with both word and translation.')
      return
    }
    const tip = String(content.tip ?? '').trim()
    setJsonError('')
    saveStructured({
      original,
      words: cleaned,
      ...(tip ? { tip } : {}),
    })
  }

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Set the full phrase learners see at the top, then each segment (word) and gloss (translation). Use ____
        in the phrase if the learner's name should appear there.
      </Text>
      <Field
        label="Original phrase"
        value={String(c.original ?? '')}
        multilineCompact
        onChangeText={(t) =>
          setContent((cur) => {
            const next = { ...cur, original: t }
            delete (next as Record<string, unknown>).heading
            return next
          })
        }
      />
      <Text style={styles.label}>Word rows</Text>
      {displayWords.map((row, i) => (
        <View key={`wb-${i}`} style={styles.bulletRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.matchRightPreviewLabel}>Word</Text>
            <AdminTextInput
              style={styles.bulletInput}
              value={String(row.word ?? '')}
              onChangeText={(t) => {
                setContent((cur) => {
                  const ws = Array.isArray(cur.words) ? ([...(cur.words as Record<string, unknown>[])]) : []
                  const base = ws.length > 0 ? ws : [{ word: '', translation: '' }]
                  const next = base.map((x, j) => (j === i ? { ...x, word: t } : x))
                  return { ...cur, words: next }
                })
              }}
              placeholder="Target language"
              placeholderTextColor="#52525b"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.matchRightPreviewLabel}>Translation</Text>
            <AdminTextInput
              style={styles.bulletInput}
              value={String(row.translation ?? '')}
              onChangeText={(t) => {
                setContent((cur) => {
                  const ws = Array.isArray(cur.words) ? ([...(cur.words as Record<string, unknown>[])]) : []
                  const base = ws.length > 0 ? ws : [{ word: '', translation: '' }]
                  const next = base.map((x, j) => (j === i ? { ...x, translation: t } : x))
                  return { ...cur, words: next }
                })
              }}
              placeholder="Gloss or explanation"
              placeholderTextColor="#52525b"
            />
          </View>
          <Pressable
            style={styles.bulletMiniBtn}
            onPress={() => {
              setContent((cur) => {
                const ws = Array.isArray(cur.words) ? ([...(cur.words as Record<string, unknown>[])]) : []
                const base = ws.length > 0 ? ws : [{ word: '', translation: '' }]
                if (base.length <= 1) return { ...cur, words: [{ word: '', translation: '' }] }
                return { ...cur, words: base.filter((_, j) => j !== i) }
              })
            }}
          >
            <Text style={styles.bulletMiniBtnTextDanger}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.addBtn}
        onPress={() => {
          setContent((cur) => {
            const ws = Array.isArray(cur.words) ? ([...(cur.words as Record<string, unknown>[])]) : []
            const base = ws.length > 0 ? ws : [{ word: '', translation: '' }]
            return { ...cur, words: [...base, { word: '', translation: '' }] }
          })
        }}
      >
        <Text style={styles.addBtnText}>+ Add word row</Text>
      </Pressable>
      <Field
        label="Tip (optional)"
        value={String(c.tip ?? '')}
        multilineCompact
        onChangeText={(t) => setContent((cur) => ({ ...cur, tip: t }))}
      />
    </View>
  )
}
