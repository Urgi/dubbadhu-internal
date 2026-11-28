/** Lesson editor form for `videoReview` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { newDraftTokenId, normalizeVideoReviewContentForEdit } from '../../../lib/lessonEditor'
import { VideoReviewFreezeFrameEditor } from '../VideoReviewFreezeFrameEditor'
import {
  AudioExposureOromoField,
  Field,
  VideoReviewDubbadhuVideoField,
  applyWordBankUrlsToExposureWord,
  isRealWordBankRowId,
  rowAfaanTextForBankPick,
  rowTranslationText,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderVideoReviewEditor(ctx: ScreenEditorContext): ReactNode {
  const { allowVideoReviewMediaFields, c, draftRef, exposureWordsForAfaanPicker, primaryScreenSaveRef, readOnlyMode, saveStructured, setContent, setVideoReviewActiveLineId, setVideoReviewVocabFocusKey, videoReviewActiveLineId, videoReviewVocabFocusKey } = ctx
  primaryScreenSaveRef.current = () => {
    const base = draftRef.current?.content as Record<string, unknown> | undefined
    if (!base) return
    saveStructured(normalizeVideoReviewContentForEdit({ ...base }))
  }
  return (
    <View style={styles.form}>
      {!allowVideoReviewMediaFields ? (
        <Text style={styles.hint}>An admin completes this step after curriculum approval.</Text>
      ) : (
        <>
          <Text style={styles.hint}>
            Pick the clip learners watch for this step; files live in the Videos-Dubbadhu bucket on Supabase.
          </Text>
          <VideoReviewDubbadhuVideoField
            videoUrl={String(c.videoUrl ?? '')}
            setContent={setContent}
            readOnly={readOnlyMode}
          />
          <VideoReviewFreezeFrameEditor
            videoUrl={String(c.videoUrl ?? '')}
            freezeAtSeconds={c.freezeAtSeconds}
            setContent={setContent}
            enabled
            readOnly={readOnlyMode}
          />
        </>
      )}
      {allowVideoReviewMediaFields ? null : (
        <VideoReviewFreezeFrameEditor
          videoUrl={String(c.videoUrl ?? '')}
          freezeAtSeconds={c.freezeAtSeconds}
          setContent={setContent}
          enabled={false}
        />
      )}
      <Text style={styles.label}>Video Lines and Vocab</Text>
      <Text style={styles.hint}>Lines to script and its associated vocab.</Text>
      {(() => {
        const lines = Array.isArray(c.lines) ? (c.lines as Record<string, unknown>[]) : []
        return (
          <>
            {lines.map((ln, idx) => {
              const id = String(ln?.id ?? `line_${idx + 1}`)
              const text = String(ln?.text ?? '')
              const vocabWords = Array.isArray(ln?.vocabWords) ? (ln.vocabWords as Record<string, unknown>[]) : []
              const vocabPreview = vocabWords
                .map((w) => String(w?.word ?? '').trim())
                .filter(Boolean)
              const hasVocab = vocabPreview.length > 0
              const lineCollapsed = hasVocab && videoReviewActiveLineId !== id
              return (
                <View key={`${id}-${idx}`} style={styles.videoReviewLineCard}>
                  {lineCollapsed ? (
                    <>
                      <View style={styles.videoReviewCollapsedHeader}>
                        <Text style={[styles.videoReviewLineTitle, styles.videoReviewLineTitleInRow]}>
                          Line {idx + 1}
                        </Text>
                        <View style={styles.videoReviewHeaderActions}>
                          <Pressable hitSlop={8} onPress={() => setVideoReviewActiveLineId(id)}>
                            <Text style={styles.videoReviewExpandLink}>Expand</Text>
                          </Pressable>
                          <Pressable
                            hitSlop={8}
                            style={styles.videoReviewRemoveLineBtnHeader}
                            onPress={() => {
                              if (videoReviewActiveLineId === id) setVideoReviewActiveLineId(null)
                              setContent((cur) => {
                                const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                                return { ...cur, lines: arr.filter((_, j) => j !== idx) }
                              })
                            }}
                          >
                            <Text style={styles.removeBtnText}>Remove line</Text>
                          </Pressable>
                        </View>
                      </View>
                      <Pressable onPress={() => setVideoReviewActiveLineId(id)}>
                        <Text style={styles.videoReviewCollapsedScript} numberOfLines={5}>
                          {text.trim() || '—'}
                        </Text>
                        <Text style={styles.videoReviewCollapsedWords} numberOfLines={3}>
                          {vocabPreview.join(' · ')}
                        </Text>
                        <Text style={styles.videoReviewCollapsedMeta}>
                          {vocabPreview.length} word{vocabPreview.length !== 1 ? 's' : ''} · tap to expand
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                  <View style={styles.videoReviewLineHeaderRow}>
                    <Text style={[styles.videoReviewLineTitle, styles.videoReviewLineTitleInRow]}>
                      Line {idx + 1}
                    </Text>
                    <Pressable
                      hitSlop={8}
                      style={styles.videoReviewRemoveLineBtnHeader}
                      onPress={() => {
                        if (videoReviewActiveLineId === id) setVideoReviewActiveLineId(null)
                        setContent((cur) => {
                          const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                          return { ...cur, lines: arr.filter((_, j) => j !== idx) }
                        })
                      }}
                    >
                      <Text style={styles.removeBtnText}>Remove line</Text>
                    </Pressable>
                  </View>
                  <Field
                    label="Line text"
                    value={text}
                    multilineCompact
                    onFocus={() => {
                      setVideoReviewActiveLineId(id)
                      setVideoReviewVocabFocusKey(`${id}:line`)
                    }}
                    onChangeText={(t) => {
                      setContent((cur) => {
                        const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                        const next = arr.map((x, j) => (j === idx ? { ...(x as Record<string, unknown>), id, text: t } : x))
                        return { ...cur, lines: next }
                      })
                    }}
                  />
                  <Text style={styles.label}>Vocab Words</Text>
                  {vocabWords.map((w, wi) => (
                    <View key={`${id}-w-${wi}`} style={styles.videoReviewWordRow}>
                      <View style={styles.videoReviewWordCol}>
                      <AudioExposureOromoField
                        compact
                        hideLabel
                        readOnly={Boolean(w.word_id)}
                        lessonHarvested={exposureWordsForAfaanPicker}
                        instanceKey={`${id}-w${wi}`}
                        externalFocusKey={videoReviewVocabFocusKey}
                        onEditorFocus={() => {
                          setVideoReviewActiveLineId(id)
                          setVideoReviewVocabFocusKey(`${id}-w${wi}`)
                        }}
                        value={String(w.word ?? '')}
                        onChangeText={(t) => {
                          setContent((cur) => {
                            const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                            const curLine = (arr[idx] as Record<string, unknown>) ?? {}
                            const ws = Array.isArray(curLine.vocabWords) ? (curLine.vocabWords as Record<string, unknown>[]) : []
                            const nextWs = ws.map((x, j) => {
                              if (j !== wi) return x
                              const prev = x as Record<string, unknown>
                              const prevText = String(prev.word ?? '').trim()
                              const nextWord: Record<string, unknown> = { ...prev, word: t }
                              delete nextWord.oromo
                              if (String(t).trim() !== prevText) {
                                delete nextWord.english
                                delete nextWord.translation
                                delete nextWord.word_id
                                delete nextWord.audioRef
                                delete nextWord.fastAudioRef
                                delete nextWord.slowAudioRef
                                if (!String(nextWord.draftTokenId ?? '').trim()) {
                                  nextWord.draftTokenId = newDraftTokenId()
                                }
                              }
                              return nextWord
                            })
                            const nextLine = { ...curLine, id, text: String(curLine.text ?? ''), vocabWords: nextWs }
                            const next = arr.map((x, j) => (j === idx ? nextLine : x))
                            return { ...cur, lines: next }
                          })
                        }}
                        onPickFromBank={(row) => {
                          setContent((cur) => {
                            const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                            const curLine = (arr[idx] as Record<string, unknown>) ?? {}
                            const ws = Array.isArray(curLine.vocabWords) ? (curLine.vocabWords as Record<string, unknown>[]) : []
                            const bankId = isRealWordBankRowId(row) ? row.id : null
                            const nextWs = ws.map((x, j) => {
                              if (j !== wi) return x
                              const item: Record<string, unknown> = {
                                ...(x as Record<string, unknown>),
                                word: rowAfaanTextForBankPick(row),
                                translation: rowTranslationText(row),
                              }
                              delete item.oromo
                              delete item.english
                              if (bankId) {
                                item.word_id = bankId
                              } else {
                                delete item.word_id
                                // Lesson-new / exposure draft: keep or mint draftTokenId so sanitize + Approve Series can link audio later.
                                const fromExposure = String(row.draftTokenId ?? '').trim()
                                const existing = String(item.draftTokenId ?? '').trim()
                                item.draftTokenId = fromExposure || existing || newDraftTokenId()
                              }
                              applyWordBankUrlsToExposureWord(item, row)
                              return item
                            })
                            const nextLine = { ...curLine, id, text: String(curLine.text ?? ''), vocabWords: nextWs }
                            const next = arr.map((x, j) => (j === idx ? nextLine : x))
                            return { ...cur, lines: next }
                          })
                        }}
                      />
                      {String(w.translation ?? w.english ?? '').trim() ? (
                        <Text style={styles.videoReviewEnglishHint}>
                          {String(w.translation ?? w.english ?? '').trim()}
                        </Text>
                      ) : null}
                      </View>
                      <Pressable
                        hitSlop={{ top: 6, bottom: 6, left: 0, right: 10 }}
                        style={styles.videoReviewRemoveWordBtn}
                        onPress={() => {
                          setContent((cur) => {
                            const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                            const curLine = (arr[idx] as Record<string, unknown>) ?? {}
                            const ws = Array.isArray(curLine.vocabWords) ? (curLine.vocabWords as Record<string, unknown>[]) : []
                            const nextWs = ws.filter((_, j) => j !== wi)
                            const nextLine = { ...curLine, id, text: String(curLine.text ?? ''), vocabWords: nextWs }
                            const next = arr.map((x, j) => (j === idx ? nextLine : x))
                            return { ...cur, lines: next }
                          })
                        }}
                      >
                        <Text style={styles.removeBtnText}>Remove word</Text>
                      </Pressable>
                    </View>
                  ))}
                  <Pressable
                    style={styles.videoReviewAddWordBtn}
                    onPress={() => {
                      setVideoReviewActiveLineId(id)
                      setVideoReviewVocabFocusKey(`${id}:add`)
                      setContent((cur) => {
                        const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                        const curLine = (arr[idx] as Record<string, unknown>) ?? {}
                        const ws = Array.isArray(curLine.vocabWords) ? (curLine.vocabWords as Record<string, unknown>[]) : []
                        const nextWs = [...ws, { word: '', draftTokenId: newDraftTokenId() }]
                        const nextLine = { ...curLine, id, text: String(curLine.text ?? ''), vocabWords: nextWs }
                        const next = arr.map((x, j) => (j === idx ? nextLine : x))
                        return { ...cur, lines: next }
                      })
                    }}
                  >
                    <Text style={styles.videoReviewAddWordBtnText}>+ Add word</Text>
                  </Pressable>
                  {hasVocab ? (
                    <Pressable
                      style={styles.videoReviewMinimizeBtn}
                      onPress={() => setVideoReviewActiveLineId(null)}
                    >
                      <Text style={styles.videoReviewMinimizeBtnText}>Minimize line</Text>
                    </Pressable>
                  ) : null}
                    </>
                  )}
                </View>
              )
            })}
            <Pressable
              style={styles.addBtn}
              onPress={() =>
                setContent((cur) => {
                  const arr = Array.isArray(cur.lines) ? (cur.lines as Record<string, unknown>[]) : []
                  return {
                    ...cur,
                    lines: [
                      ...arr,
                      {
                        id: `line_${arr.length + 1}`,
                        text: '',
                        vocabWords: [{ word: '', draftTokenId: newDraftTokenId() }],
                      },
                    ],
                  }
                })
              }
            >
              <Text style={styles.addBtnText}>+ Add line</Text>
            </Pressable>
          </>
        )
      })()}
    </View>
  )
}
