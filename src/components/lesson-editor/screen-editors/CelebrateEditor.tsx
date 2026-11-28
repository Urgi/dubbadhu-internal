/** Lesson editor form for `CelebrateScreen` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { celebrateLearnedWarning } from '../../../lib/learnerTextLimits'
import {
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native'
import { AdminTextInput } from '../../AdminTextInput'
import {
  VOCAB_SECTION_OPTIONS,
  celebrateAfaanDedupeKey,
  celebrateExposureWordRows,
  celebrateLearnedExtraEditorRows,
  celebrateLearnedExtraFromContent,
  celebrateLearnedWordRows,
  celebrateLearnedWordsFromScreens,
  celebrateSpeakingWordRows,
  celebrateSanitizedLearnedExtra,
  mergeCelebrateLearnedFromExposureAndExtra,
} from '../../../lib/lessonEditor'
import {
  CelebrateVocabSectionPicker,
  DiscussionPillsField,
  Field,
  Row,
  showCommunityPromptAuthoringNotes,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderCelebrateEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, lessonScreens, primaryScreenSaveRef, saveStructured, setContent } = ctx
  const exposureRows = celebrateExposureWordRows(lessonScreens)
  const speakingOnlyRows = celebrateSpeakingWordRows(lessonScreens).filter(
    (row) => !exposureRows.some((e) => celebrateAfaanDedupeKey(e.afaan) === celebrateAfaanDedupeKey(row.afaan)),
  )
  const autoKeys = new Set(
    celebrateLearnedWordRows(lessonScreens).map((r) => celebrateAfaanDedupeKey(r.afaan)),
  )
  const extraRows = celebrateLearnedExtraEditorRows(c as Record<string, unknown>, autoKeys)
  const updateLearnedExtra = (fn: (rows: string[]) => string[]) => {
    setContent((cur) => {
      const keys = new Set(
        celebrateLearnedWordRows(lessonScreens).map((r) => celebrateAfaanDedupeKey(r.afaan)),
      )
      const row0 = celebrateLearnedExtraEditorRows(cur as Record<string, unknown>, keys)
      return { ...cur, learned_extra: fn(row0) }
    })
  }
  const vocabSectionId = String(c.vocabSectionId ?? '').trim()
  const vocabSectionLabel =
    VOCAB_SECTION_OPTIONS.find((o) => o.value === vocabSectionId)?.label ??
    (vocabSectionId || 'None (Language Vocab)')
  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const base = { ...(d.content as Record<string, unknown>) }
    delete base.learned_words
    delete base.title
    const exp = celebrateLearnedWordsFromScreens(lessonScreens)
    const keys = new Set(exp.map(celebrateAfaanDedupeKey))
    const extra = Array.isArray(base.learned_extra)
      ? celebrateSanitizedLearnedExtra(base.learned_extra)
      : celebrateLearnedExtraFromContent(base, keys)
    const learned = mergeCelebrateLearnedFromExposureAndExtra(exp, extra)
    saveStructured({ ...base, learned, learned_extra: extra })
  }
  const communityOn =
    c.communityDiscussionEnabled === true ||
    c.communityDiscussionEnabled === 'true' ||
    c.communityDiscussionEnabled === 1 ||
    c.communityDiscussionEnabled === '1'
  return (
    <View style={styles.form}>
      <Field label="Message" value={String(c.message ?? '')} allowMultiline onChangeText={(t) => setContent((cur) => ({ ...cur, message: t }))} />
      <Text style={styles.label}>Vocab button link</Text>
      <Text style={styles.hint}>
        Optional. With a section, learner CTA is “Series Vocab” and opens that Vocab tab section. With none, CTA is
        “Language Vocab” (all vocabulary).
      </Text>
      <CelebrateVocabSectionPicker
        value={vocabSectionId}
        label={vocabSectionLabel}
        onChange={(next) =>
          setContent((cur) => {
            const out = { ...cur }
            if (next) out.vocabSectionId = next
            else delete out.vocabSectionId
            return out
          })
        }
      />
      <Row label="Community discussion" onInfoPress={showCommunityPromptAuthoringNotes}>
        <Switch
          value={Boolean(communityOn)}
          onValueChange={(on) =>
            setContent((cur) => {
              if (!on) {
                const next = { ...cur }
                delete next.communityDiscussionEnabled
                delete next.communityDiscussionPrompt
                delete next.communityDiscussionCommentPills
                delete next.communityDiscussionReplyPills
                delete next.communityDiscussionAllowedEnglish
                delete next.quickReplyEmoji
                return next
              }
              return { ...cur, communityDiscussionEnabled: true }
            })
          }
          trackColor={{ false: '#3f3f46', true: '#E8870A' }}
          thumbColor="#fff"
        />
      </Row>
      {communityOn ? (
        <>
          <Field
            label="Discussion prompt"
            value={String(c.communityDiscussionPrompt ?? '')}
            allowMultiline
            onInfoPress={showCommunityPromptAuthoringNotes}
            onChangeText={(t) => setContent((cur) => ({ ...cur, communityDiscussionPrompt: t }))}
          />
          <Text style={styles.hint}>
            Spell the target word exactly as learners must type it (quote it, or “Say Akkam…”). Tap i for the full notes.
          </Text>
          <DiscussionPillsField
            label="Comment pills (new comment, max 6)"
            hint="Ready-made messages a learner can tap to post. Each pill is the whole message, emoji allowed (e.g. Akkam 👋)."
            value={c.communityDiscussionCommentPills}
            onChange={(next) =>
              setContent((cur) => {
                const out = { ...cur }
                if (next) out.communityDiscussionCommentPills = next
                else delete out.communityDiscussionCommentPills
                return out
              })
            }
          />
          <DiscussionPillsField
            label="Reply pills (reply to someone, max 6)"
            hint="Shown when a learner replies to a comment (e.g. Galatoomi 🙏)."
            value={c.communityDiscussionReplyPills}
            onChange={(next) =>
              setContent((cur) => {
                const out = { ...cur }
                if (next) out.communityDiscussionReplyPills = next
                else delete out.communityDiscussionReplyPills
                return out
              })
            }
          />
          <Field
            label="Allowed English / non-Oromo (AI only, optional)"
            value={String(c.communityDiscussionAllowedEnglish ?? '')}
            allowMultiline
            onChangeText={(t) =>
              setContent((cur) => ({ ...cur, communityDiscussionAllowedEnglish: t }))
            }
          />
          <Text style={styles.hint}>
            Free-text note for moderation (not shown to learners). Example: “English names and
            ‘hello’ are OK; otherwise prefer Afaan Oromo.”
          </Text>
          <Text style={styles.label}>Quick-reply emoji</Text>
          <Text style={styles.hint}>
            Optional emoji added to each phrase chip on the celebration (e.g. Akkam 👋🏾). Leave empty for none.
          </Text>
          {[...exposureRows.map((r) => r.afaan), ...extraRows]
            .map((w) => String(w || '').trim())
            .filter((w, i, arr) => w && arr.indexOf(w) === i)
            .map((phrase) => {
              const map =
                c.quickReplyEmoji && typeof c.quickReplyEmoji === 'object'
                  ? (c.quickReplyEmoji as Record<string, string>)
                  : {}
              return (
                <Field
                  key={`qr-emoji-${phrase}`}
                  label={phrase}
                  value={String(map[phrase] ?? '')}
                  onChangeText={(t) =>
                    setContent((cur) => {
                      const prev =
                        cur.quickReplyEmoji && typeof cur.quickReplyEmoji === 'object'
                          ? { ...(cur.quickReplyEmoji as Record<string, string>) }
                          : {}
                      const v = t.trim().slice(0, 16)
                      if (v) prev[phrase] = v
                      else delete prev[phrase]
                      return { ...cur, quickReplyEmoji: prev }
                    })
                  }
                />
              )
            })}
        </>
      ) : (
        <Text style={styles.hint}>
          Off = classic celebration. On = live community chat on this screen; posts use the same AI moderation as Lesson Discussions. Tap i for how to write the prompt.
        </Text>
      )}
      {celebrateLearnedWarning(
        new Set(
          [...exposureRows.map((r) => r.afaan), ...speakingOnlyRows.map((r) => r.afaan), ...extraRows]
            .map((w) => celebrateAfaanDedupeKey(String(w || '')))
            .filter(Boolean),
        ).size,
      ) ? (
        <Text style={styles.lengthWarn}>
          {celebrateLearnedWarning(
            new Set(
              [...exposureRows.map((r) => r.afaan), ...speakingOnlyRows.map((r) => r.afaan), ...extraRows]
                .map((w) => celebrateAfaanDedupeKey(String(w || '')))
                .filter(Boolean),
            ).size,
          )}
        </Text>
      ) : null}
      <View style={styles.learnedBlock}>
        <Text style={styles.label}>From Audio exposure</Text>
        <Text style={styles.hint}>
          These follow every Audio exposure in lesson order. They update when you save after changing exposure screens;
          removed exposure words drop off unless you also add them below.
        </Text>
        {exposureRows.length ? (
          <View style={styles.learnedList}>
            {exposureRows.map((row) => (
              <View key={row.afaan} style={styles.learnedReadOnlyRow}>
                <Text style={styles.learnedText}>{row.afaan}</Text>
                {row.english ? <Text style={styles.learnedReadOnlySub}>{row.english}</Text> : null}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>None yet. Add words on Audio exposure screens, or only use additional words below.</Text>
        )}
      </View>
      <View style={styles.learnedBlock}>
        <Text style={styles.label}>From speaking (not on Audio exposure)</Text>
        <Text style={styles.hint}>
          Speaking-practice phrases that Audio exposure does not already have. Same Afaan is skipped.
        </Text>
        {speakingOnlyRows.length ? (
          <View style={styles.learnedList}>
            {speakingOnlyRows.map((row) => (
              <View key={`speak-${row.afaan}`} style={styles.learnedReadOnlyRow}>
                <Text style={styles.learnedText}>{row.afaan}</Text>
                {row.english ? <Text style={styles.learnedReadOnlySub}>{row.english}</Text> : null}
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>None. Speaking screens match Audio exposure, or this lesson has no speaking phrases yet.</Text>
        )}
      </View>
      <View style={styles.learnedBlock}>
        <Text style={styles.label}>Additional words</Text>
        <Text style={styles.hint}>
          Kept when exposure or speaking screens change. Duplicates of an auto word are skipped in the final list.
        </Text>
        {extraRows.map((ex, i) => (
          <View key={`celebrate-extra-${i}`} style={styles.bulletRow}>
            <AdminTextInput
              style={styles.bulletInput}
              value={ex}
              onChangeText={(t) => {
                updateLearnedExtra((rows) => {
                  const next = [...rows]
                  next[i] = t
                  return next
                })
              }}
              placeholder="Afaan (optional)"
              placeholderTextColor="#52525b"
            />
            <Pressable
              style={styles.bulletMiniBtn}
              onPress={() => {
                updateLearnedExtra((rows) => rows.filter((_, j) => j !== i))
              }}
            >
              <Text style={styles.bulletMiniBtnTextDanger}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable style={styles.addBtn} onPress={() => updateLearnedExtra((rows) => [...rows, ''])}>
          <Text style={styles.addBtnText}>+ Add word</Text>
        </Pressable>
      </View>
    </View>
  )
}
