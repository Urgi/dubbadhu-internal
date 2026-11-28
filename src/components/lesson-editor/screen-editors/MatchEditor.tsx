/** Lesson editor form for `match` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native'
import { celebrateExposureWordRows } from '../../../lib/lessonEditor'
import {
  WordBankPicker,
  rowAfaanTextForBankPick,
  rowTranslationText,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderMatchEditor(ctx: ScreenEditorContext): ReactNode {
  const { allowJsonEditing, c, draftRef, lessonScreens, onPressQuizAllFromSeries, primaryScreenSaveRef, readOnlyMode, saveStructured, seriesMatchFillBusy, setContent, setJsonError } = ctx
  let pairs = (c.pairs as Record<string, unknown>[] | undefined) ?? []
  if (!Array.isArray(pairs)) pairs = []
  primaryScreenSaveRef.current = () => {
    setJsonError('')
    const d = draftRef.current
    if (!d) return
    const content = d.content as Record<string, unknown>
    const pr = content.pairs
    if (!Array.isArray(pr) || pr.length === 0) {
      setJsonError(
        allowJsonEditing
          ? 'Match screen needs at least one pair. Add a pair first (or paste JSON and Apply JSON & close).'
          : 'Match screen needs at least one pair. Add a pair first.',
      )
      return
    }
    saveStructured(content)
  }
  return (
    <View style={styles.form}>
      {!readOnlyMode ? (
        <Pressable
          style={[styles.fillFromExposureBtn, seriesMatchFillBusy && { opacity: 0.6 }]}
          disabled={seriesMatchFillBusy}
          onPress={onPressQuizAllFromSeries}
        >
          {seriesMatchFillBusy ? (
            <ActivityIndicator color="#e4e4e7" />
          ) : (
            <>
              <Text style={styles.fillFromExposureBtnText}>Quiz all from series</Text>
              <Text style={styles.fillFromExposureBtnSub}>
                Fills pairs from every lesson in this series (audio exposure, match, video-review
                vocab, speaking, repetition). Uses lesson JSON — voice bank not required.
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
      {pairs.length === 0 ? (
        <View style={styles.matchEmptyBlock}>
          <Text style={styles.hint}>
            No pairs yet. Remove everything to start fresh, then use + Add pair. You need at least one pair before Save
            screen.
          </Text>
          <Pressable
            style={styles.fillFromExposureBtn}
            onPress={() => {
              const rows = celebrateExposureWordRows(lessonScreens)
              if (rows.length === 0) {
                setJsonError('No words on Audio exposure screens in this lesson yet.')
                return
              }
              setJsonError('')
              setContent((cur) => ({
                ...cur,
                pairs: rows.map((r) => ({ left: r.afaan, right: r.english })),
              }))
            }}
          >
            <Text style={styles.fillFromExposureBtnText}>Add all from Audio exposure in this lesson</Text>
            <Text style={styles.fillFromExposureBtnSub}>
              One-time fill: every word from Audio exposure screens (order in lesson, Afaan deduped).
            </Text>
          </Pressable>
        </View>
      ) : null}
      {pairs.map((p, i) => (
        <View key={i} style={styles.pairCard}>
          <Text style={styles.personTitle}>Pair {i + 1}</Text>
          {String(p.left ?? '').trim() ? (
            <View style={styles.matchSelectedBox}>
              <Text style={styles.matchSelectedTop}>{String(p.left ?? '').trim()}</Text>
              <Text style={styles.matchSelectedSub}>{String(p.right ?? '').trim() || '—'}</Text>
            </View>
          ) : (
            <>
              <WordBankPicker
                label="Word (Oromo)"
                value={null}
                onPick={(row) => {
                  setContent((cur) => {
                    const pr = (cur.pairs as Record<string, unknown>[]) ?? []
                    const next = pr.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            word_id: row.id,
                            left_word_id: row.id,
                            left: rowAfaanTextForBankPick(row),
                            right: rowTranslationText(row),
                          }
                        : x,
                    )
                    return { ...cur, pairs: next }
                  })
                }}
                placeholder="Search Oromo word…"
              />
              <Text style={styles.matchRightPreviewLabel}>Right option (English)</Text>
              <Text style={styles.matchRightPreview}>—</Text>
            </>
          )}
          <Pressable
            style={styles.removeBtn}
            onPress={() => {
              setContent((cur) => {
                const pr = (cur.pairs as Record<string, unknown>[]) ?? []
                return { ...cur, pairs: pr.filter((_, j) => j !== i) }
              })
            }}
          >
            <Text style={styles.removeBtnText}>Remove pair</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.addBtn}
        onPress={() =>
          setContent((cur) => {
            const pr = (cur.pairs as Record<string, unknown>[]) ?? []
            return { ...cur, pairs: [...pr, { left: '', right: '' }] }
          })
        }
      >
        <Text style={styles.addBtnText}>+ Add pair</Text>
      </Pressable>
    </View>
  )
}
