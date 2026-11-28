/** Lesson editor form for `communityBoard` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Text, View } from 'react-native'
import {
  DiscussionPillsField,
  Field,
  InfoCircleButton,
  showCommunityPromptAuthoringNotes,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderCommunityBoardEditor(ctx: ScreenEditorContext): ReactNode {
  const { c, draftRef, primaryScreenSaveRef, saveStructured, setContent } = ctx
  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    saveStructured({ ...(d.content as Record<string, unknown>) })
  }
  return (
    <View style={styles.form}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, styles.labelInRow]}>Community board</Text>
        <InfoCircleButton onPress={showCommunityPromptAuthoringNotes} />
      </View>
      <Text style={styles.hint}>
        Learners see the prompt and post to the same moderated community chat as celebration discussion. Tap i for how to spell the target word.
      </Text>
      <Field
        label="Prompt (shown to learners)"
        value={String(c.prompt ?? '')}
        allowMultiline
        onInfoPress={showCommunityPromptAuthoringNotes}
        onChangeText={(t) => setContent((cur) => ({ ...cur, prompt: t }))}
      />
      <Field
        label="Topic (optional, AI context only)"
        value={String(c.topic ?? '')}
        onChangeText={(t) => setContent((cur) => ({ ...cur, topic: t }))}
      />
      <Text style={styles.hint}>
        Topic is extra context for moderation. Learners see the prompt, not this field.
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
    </View>
  )
}
