import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const retentionSql = readFileSync(join(process.cwd(), 'sql/obsidian_retention.sql'), 'utf8')
const viewsSql = readFileSync(join(process.cwd(), 'sql/obsidian_sql.sql'), 'utf8')

async function main() {
const db = new PGlite()

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.users (
    id uuid primary key,
    phone text,
    exclude_from_analytics boolean not null default false
  );
  create table public.analytics_events (
    id uuid primary key,
    user_id uuid,
    event_name text,
    created_at timestamptz not null default now()
  );
  create table public.obsidian_threads (
    id uuid primary key default gen_random_uuid(),
    title text not null default 'New thread',
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.obsidian_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.obsidian_threads (id) on delete cascade,
    role text not null,
    content text not null default '',
    status text,
    created_at timestamptz not null default now()
  );
`)

await db.exec(retentionSql)
await db.exec(viewsSql)

await db.exec(`
  insert into public.obsidian_threads (title, keep, kept_at, updated_at)
  values ('kept', true, now(), now() - interval '30 days');
  insert into public.obsidian_threads (title, keep, updated_at)
  values ('boundary', false, now() - interval '7 days' + interval '5 minutes');
`)

const stale = await db.query<{ id: string }>(
  `insert into public.obsidian_threads (title, keep, updated_at)
   values ('stale', false, now() - interval '8 days')
   returning id`,
)
const active = await db.query<{ id: string }>(
  `insert into public.obsidian_threads (title, keep, updated_at)
   values ('active old shell', false, now() - interval '20 days')
   returning id`,
)
const staleId = stale.rows[0].id
const activeId = active.rows[0].id

await db.query(
  `insert into public.obsidian_messages (thread_id, role, content, created_at)
   values ($1, 'user', 'old', now() - interval '8 days')`,
  [staleId],
)
await db.query(
  `insert into public.obsidian_messages (thread_id, role, content, created_at)
   values ($1, 'user', 'yesterday', now() - interval '1 day')`,
  [activeId],
)

type PurgeRow = { dry_run: boolean; deleted: number; matched: number; thread_ids: string[] }

async function purge(dryRun: boolean): Promise<PurgeRow> {
  const result = await db.query<PurgeRow>(
    `select
       (r ->> 'dry_run')::boolean as dry_run,
       (r ->> 'deleted')::int as deleted,
       (r ->> 'matched')::int as matched,
       array(select jsonb_array_elements_text(r -> 'thread_ids')) as thread_ids
     from (select public.obsidian_purge_stale_threads($1) as r) s`,
    [dryRun],
  )
  return result.rows[0]
}

const preview = await purge(true)
assert.equal(preview.dry_run, true)
assert.equal(preview.deleted, 0)
assert.equal(preview.matched, 1)
assert.deepEqual(preview.thread_ids, [staleId])

const stillThere = await db.query<{ n: number }>(
  `select count(*)::int as n from public.obsidian_threads where id = $1`,
  [staleId],
)
assert.equal(stillThere.rows[0].n, 1)

const purged = await purge(false)
assert.equal(purged.deleted, 1)
assert.equal(purged.matched, 1)
assert.deepEqual(purged.thread_ids, [staleId])

const remaining = await db.query<{ title: string }>(
  `select title from public.obsidian_threads order by title`,
)
assert.deepEqual(
  remaining.rows.map((row) => row.title),
  ['active old shell', 'boundary', 'kept'],
)

const messages = await db.query<{ n: number }>(
  `select count(*)::int as n from public.obsidian_messages where thread_id = $1`,
  [staleId],
)
assert.equal(messages.rows[0].n, 0)

const survivorMessages = await db.query<{ n: number }>(
  `select count(*)::int as n from public.obsidian_messages where thread_id = $1`,
  [activeId],
)
assert.equal(survivorMessages.rows[0].n, 1)

await db.exec('begin')
const exact = await db.query<{ id: string }>(
  `insert into public.obsidian_threads (title, keep, updated_at)
   values ('exact', false, now() - interval '7 days')
   returning id`,
)
const exactPreview = await purge(true)
assert.equal(exactPreview.matched, 0)
assert.equal(exactPreview.thread_ids.includes(exact.rows[0].id), false)
await db.exec('rollback')

const excluded = '00000000-0000-4000-8000-000000000001'
const learner = '00000000-0000-4000-8000-000000000002'
await db.query(
  `insert into public.users (id, phone, exclude_from_analytics) values
     ($1, '251911000000', true),
     ($2, '251911000001', false)`,
  [excluded, learner],
)
await db.query(
  `insert into public.analytics_events (id, user_id, event_name) values
     ('00000000-0000-4000-8000-000000000011', $1, 'app_opened'),
     ('00000000-0000-4000-8000-000000000012', $2, 'app_opened'),
     ('00000000-0000-4000-8000-000000000013', null, 'signin_failed')`,
  [excluded, learner],
)
const visibleUsers = await db.query<{ id: string }>(`select id from public.obsidian_users_analytics order by id`)
assert.deepEqual(
  visibleUsers.rows.map((row) => row.id),
  [learner],
)
const visibleEvents = await db.query<{ event_name: string }>(
  `select event_name from public.obsidian_events_analytics order by event_name`,
)
assert.deepEqual(
  visibleEvents.rows.map((row) => row.event_name),
  ['app_opened', 'signin_failed'],
)

const again = await purge(false)
assert.equal(again.deleted, 0)
assert.equal(again.matched, 0)

console.log('obsidian-purge-sql-check ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
