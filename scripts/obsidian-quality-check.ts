import assert from 'node:assert/strict'
import { ACE_WEBHOOK_URL } from '../supabase/functions/_shared/obsidian.ts'
import { resolveObsidianSendDecision } from '../supabase/functions/_shared/obsidianRoute.ts'
import { shouldPurgeObsidianThread } from '../supabase/functions/_shared/obsidianRetention.ts'
import { resolveCrewWebhook } from '../supabase/functions/_shared/obsidianWebhook.ts'

const now = Date.parse('2026-09-23T12:00:00.000Z')

assert.equal(
  shouldPurgeObsidianThread({
    keep: false,
    updatedAt: '2026-09-16T12:00:00.000Z',
    latestMessageAt: null,
    nowMs: now,
  }),
  false,
  'exactly 7 days stays',
)

assert.equal(
  shouldPurgeObsidianThread({
    keep: false,
    updatedAt: '2026-09-16T11:59:59.999Z',
    latestMessageAt: null,
    nowMs: now,
  }),
  true,
  'older than 7 days is purged',
)

assert.equal(
  shouldPurgeObsidianThread({
    keep: false,
    updatedAt: '2026-09-01T12:00:00.000Z',
    latestMessageAt: '2026-09-22T12:00:00.000Z',
    nowMs: now,
  }),
  false,
  'yesterday message keeps an old thread',
)

assert.equal(
  shouldPurgeObsidianThread({
    keep: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    latestMessageAt: null,
    nowMs: now,
  }),
  false,
  'kept thread stays',
)

assert.deepEqual(
  resolveObsidianSendDecision('how many OTP failures last week?', { action: 'handoff', route: 'jack' }),
  { action: 'chat' },
)

assert.deepEqual(resolveObsidianSendDecision('fix the OTP bug', { action: 'chat' }), {
  action: 'handoff',
  route: 'jack',
})

assert.deepEqual(resolveObsidianSendDecision('the mic is broken', { action: 'handoff', route: 'ace' }), {
  action: 'handoff',
  route: 'jack',
})

assert.deepEqual(
  resolveObsidianSendDecision('@jack the friends invite returns not_found', { action: 'chat' }),
  { action: 'handoff', route: 'jack' },
)

assert.deepEqual(
  resolveObsidianSendDecision('friends invite returns not_found', { action: 'handoff', route: 'jack' }),
  { action: 'chat' },
)

assert.deepEqual(resolveObsidianSendDecision('assign this', null), { action: 'handoff', route: 'ace' })

assert.deepEqual(
  resolveObsidianSendDecision('ask moti to review this Afaan line', { action: 'handoff', route: 'ace' }),
  { action: 'handoff', route: 'moti' },
)

assert.deepEqual(
  resolveObsidianSendDecision('what is our retention this week', { action: 'handoff', route: 'ace' }),
  { action: 'chat' },
)

assert.deepEqual(
  resolveObsidianSendDecision('how is friends invite implemented in the codebase?', { action: 'chat' }),
  { action: 'handoff', route: 'jack' },
)

assert.deepEqual(
  resolveObsidianSendDecision('look at the code and explain OTP', { action: 'handoff', route: 'ace' }),
  { action: 'handoff', route: 'jack' },
)

assert.deepEqual(
  resolveObsidianSendDecision('help me prioritize the product roadmap this week', { action: 'chat' }),
  { action: 'handoff', route: 'ace' },
)

assert.deepEqual(
  resolveObsidianSendDecision('what should we schedule for the next release', null),
  { action: 'handoff', route: 'ace' },
)

assert.deepEqual(
  resolveCrewWebhook('jack', {
    JACK_WEBHOOK_URL: 'https://jack.example/hook',
    JACK_WEBHOOK_KEY: 'secret',
  }),
  { ok: true, target: { url: 'https://jack.example/hook', key: 'secret', via: 'jack' } },
)

assert.deepEqual(resolveCrewWebhook('jack', { ACE_WEBHOOK_KEY: 'ace-key' }), {
  ok: false,
  error: 'Jack handoff needs JACK_WEBHOOK_URL and JACK_WEBHOOK_KEY on the Edge Function.',
})

assert.deepEqual(
  resolveCrewWebhook('queen', {
    ACE_WEBHOOK_KEY: 'ace-key',
    JACK_WEBHOOK_URL: 'https://jack.example/hook',
    JACK_WEBHOOK_KEY: 'secret',
  }),
  { ok: true, target: { url: ACE_WEBHOOK_URL, key: 'ace-key', via: 'ace' } },
)

console.log('obsidian-quality-check ok')
