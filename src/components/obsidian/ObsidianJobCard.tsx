import { Pressable, StyleSheet, Text, View } from 'react-native'
import { crewDisplayName, isCrewRouteName, OBSIDIAN_CREW } from '../../lib/obsidianCrew'
import type { ObsidianCrewRoute, ObsidianMessage } from '../../lib/obsidian'
import {
  jobStatusFromMessage,
  parseObsidianJob,
  type JobCardStatus,
  type ObsidianJobPayload,
} from '../../lib/obsidianJob'
import GeminiMarkdownText from '../GeminiMarkdownText'

type Props = {
  message: ObsidianMessage
  assigningId: string | null
  expanded: boolean
  onToggleExpand: () => void
  onAssign: (job: ObsidianJobPayload) => void
  onEdit: (job: ObsidianJobPayload) => void
  onChangeAgent: (job: ObsidianJobPayload) => void
  onAskObsidian: (job: ObsidianJobPayload) => void
  onRevise: (job: ObsidianJobPayload) => void
}

const STATUS_LABEL: Record<JobCardStatus, string> = {
  draft: 'Ready to hand off',
  assigning: 'Assigning…',
  assigned: 'Assigned',
  in_progress: 'is working',
  needs_input: 'Needs input',
  completed: 'completed the job',
  failed: 'Job failed',
  cancelled: 'Cancelled',
}

export default function ObsidianJobCard({
  message,
  assigningId,
  expanded,
  onToggleExpand,
  onAssign,
  onEdit,
  onChangeAgent,
  onAskObsidian,
  onRevise,
}: Props) {
  const parsed = parseObsidianJob(message.content)
  const agentId: ObsidianCrewRoute =
    parsed?.assignedAgentId ??
    (isCrewRouteName(message.role) ? message.role : 'ace')
  const name = crewDisplayName(agentId)
  const color = OBSIDIAN_CREW[agentId].color
  const assigning = assigningId === message.id
  const status = assigning ? 'assigning' : jobStatusFromMessage(message.status, parsed)
  const job: ObsidianJobPayload = parsed ?? {
    v: 1,
    kind: 'job',
    assignedAgentId: agentId,
    objective: message.content.replace(/working…$/i, '').trim() || `Job for ${name}`,
    deliverable: 'Return the completed work in this thread.',
    contextSummary: 'Current Obsidian thread.',
    priority: 'normal',
    jobStatus: status,
  }

  const title =
    status === 'in_progress' || status === 'assigned'
      ? `${name} ${STATUS_LABEL.in_progress}`
      : status === 'completed'
        ? `${name} ${STATUS_LABEL.completed}`
        : STATUS_LABEL[status]

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={[styles.kicker, { color }]}>{name}</Text>
      <Text style={styles.title}>{title}</Text>
      {status === 'in_progress' || status === 'assigned' ? (
        <Text style={styles.body}>{job.progressNote || job.objective}</Text>
      ) : null}
      {status === 'draft' || status === 'assigning' ? (
        <View style={styles.fields}>
          <Field label="Agent" value={name} />
          <Field label="Objective" value={job.objective} />
          <Field label="Deliverable" value={job.deliverable} />
          <Field label="Context included" value={job.contextSummary} />
          <Field label="Priority" value={job.priority} />
          <Field label="Due" value={job.dueAt ? job.dueAt : 'No deadline'} />
        </View>
      ) : null}
      {status === 'completed' ? (
        <View style={styles.result}>
          <Text style={styles.summary}>{job.summary || job.objective}</Text>
          {expanded && (job.result || message.content) ? (
            <GeminiMarkdownText text={job.result || message.content} />
          ) : null}
        </View>
      ) : null}
      {status === 'failed' ? <Text style={styles.error}>{job.progressNote || message.content}</Text> : null}
      {status === 'needs_input' ? <Text style={styles.body}>{job.progressNote || job.objective}</Text> : null}

      <View style={styles.actions}>
        {status === 'draft' ? (
          <>
            <Action label="Edit job" onPress={() => onEdit(job)} />
            <Action label={`Assign to ${name}`} primary onPress={() => onAssign(job)} />
            <Action label="Change agent" onPress={() => onChangeAgent(job)} />
          </>
        ) : null}
        {status === 'assigning' ? <Text style={styles.meta}>Waiting for assignment…</Text> : null}
        {status === 'in_progress' || status === 'assigned' ? (
          <Action label="View job details" onPress={onToggleExpand} />
        ) : null}
        {expanded && (status === 'in_progress' || status === 'assigned') ? (
          <View style={styles.fields}>
            <Field label="Objective" value={job.objective} />
            <Field label="Deliverable" value={job.deliverable} />
          </View>
        ) : null}
        {status === 'completed' ? (
          <>
            <Action label={expanded ? 'Hide full result' : 'View full result'} onPress={onToggleExpand} />
            <Action label="Ask Obsidian about this" onPress={() => onAskObsidian(job)} />
            <Action label={`Send revision to ${name}`} onPress={() => onRevise(job)} />
          </>
        ) : null}
      </View>
    </View>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

function Action({
  label,
  onPress,
  primary,
}: {
  label: string
  onPress: () => void
  primary?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, primary && styles.actionPrimary, pressed && styles.pressed]}
    >
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderLeftWidth: 3,
    padding: 12,
    gap: 8,
  },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  title: { color: '#f9fafb', fontSize: 16, fontWeight: '700' },
  body: { color: '#d1d5db', fontSize: 14, lineHeight: 20 },
  summary: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  error: { color: '#fca5a5', fontSize: 13, lineHeight: 18 },
  fields: { gap: 8 },
  field: { gap: 2 },
  fieldLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  fieldValue: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  result: { gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  action: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3f3f46',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionPrimary: { backgroundColor: '#e5e7eb', borderColor: '#e5e7eb' },
  actionText: { color: '#d1d5db', fontSize: 12, fontWeight: '700' },
  actionTextPrimary: { color: '#111111' },
  pressed: { opacity: 0.88 },
  meta: { color: '#9ca3af', fontSize: 12 },
})
