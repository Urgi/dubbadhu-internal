-- Obsidian Team — phone relay for the Claude Crew Mac app (~/dev/claude-crew).
-- The Mac app is the brain: it runs the bots on Urgi's Claude subscription and mirrors each chat here.
-- The internal app reads these tables, writes new messages (source 'phone'), and sends Approve/Deny
-- through the crew-decide Edge Function, which signs the decision. The Mac only runs signed decisions,
-- because the internal app binary carries the service role key and could otherwise forge a row.
--
-- Apply in Supabase → SQL Editor on prod (hvyqcfehonhwoayrvggk). Only creates new crew_* tables.
-- Then deploy crew-decide and set CREW_DECISION_SECRET (same value as CREW_DECISION_SECRET in
-- ~/dev/claude-crew/.env).
--
-- Admin gate matches sql/obsidian.sql (ADMIN_EMAIL). service_role bypasses RLS.

-- One row per bot. The Mac app upserts these and refreshes mac_seen_at every 30s.
create table if not exists public.crew_bots (
  id text primary key,
  name text not null,
  color text not null default '#9ca3af',
  shape text not null default 'round',
  mode text not null default 'chat',
  sort int not null default 0,
  busy boolean not null default false,
  waiting int not null default 0,
  last_role text,
  last_text text,
  last_at timestamptz,
  mac_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Chat messages. Mac rows mirror its local history; phone rows are queued for the Mac to pick up.
create table if not exists public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null references public.crew_bots (id) on delete cascade,
  role text not null,
  text text not null default '',
  tools jsonb not null default '[]'::jsonb,
  action_ids text[] not null default '{}',
  note text,
  source text not null default 'mac',
  routine text,
  add_on boolean not null default false,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_messages_role_check check (role in ('user', 'assistant')),
  constraint crew_messages_source_check check (source in ('mac', 'phone', 'routine')),
  constraint crew_messages_status_check check (status is null or status in ('queued', 'taken', 'failed'))
);

create index if not exists crew_messages_bot_created_idx
  on public.crew_messages (bot_id, created_at);

create index if not exists crew_messages_queued_idx
  on public.crew_messages (created_at)
  where status = 'queued';

-- Approval cards, mirrored from the Mac. Only the Mac changes them.
create table if not exists public.crew_actions (
  id text primary key,
  bot_id text not null references public.crew_bots (id) on delete cascade,
  tool text,
  title text not null default '',
  command text,
  target text,
  environment text,
  danger text,
  reason text,
  preview jsonb,
  status text not null default 'pending',
  output text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint crew_actions_status_check
    check (status in ('pending', 'confirm', 'approved', 'denied', 'done', 'failed', 'expired'))
);

create index if not exists crew_actions_bot_idx
  on public.crew_actions (bot_id, created_at);

-- Approve/Deny taps from the phone. Written only by crew-decide (service role), which checks the
-- signed-in admin and adds an HMAC signature. The Mac verifies the signature, then marks it processed.
create table if not exists public.crew_decisions (
  id uuid primary key default gen_random_uuid(),
  action_id text not null references public.crew_actions (id) on delete cascade,
  bot_id text not null,
  decision text not null,
  confirm boolean not null default false,
  decided_by uuid,
  signature text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  result text,
  constraint crew_decisions_decision_check check (decision in ('approve', 'deny'))
);

create index if not exists crew_decisions_unprocessed_idx
  on public.crew_decisions (created_at)
  where processed_at is null;

alter table public.crew_bots enable row level security;
alter table public.crew_messages enable row level security;
alter table public.crew_actions enable row level security;
alter table public.crew_decisions enable row level security;

drop policy if exists crew_bots_admin_read on public.crew_bots;
create policy crew_bots_admin_read
  on public.crew_bots
  for select
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

drop policy if exists crew_messages_admin_read on public.crew_messages;
create policy crew_messages_admin_read
  on public.crew_messages
  for select
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

-- The admin may only add queued phone messages, never edit the Mac's rows.
drop policy if exists crew_messages_admin_send on public.crew_messages;
create policy crew_messages_admin_send
  on public.crew_messages
  for insert
  to authenticated
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com'
    and role = 'user'
    and source = 'phone'
    and status = 'queued'
  );

drop policy if exists crew_actions_admin_read on public.crew_actions;
create policy crew_actions_admin_read
  on public.crew_actions
  for select
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

drop policy if exists crew_decisions_admin_read on public.crew_decisions;
create policy crew_decisions_admin_read
  on public.crew_decisions
  for select
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

revoke all on public.crew_bots from anon, public;
revoke all on public.crew_messages from anon, public;
revoke all on public.crew_actions from anon, public;
revoke all on public.crew_decisions from anon, public;
grant select on public.crew_bots to authenticated;
grant select, insert on public.crew_messages to authenticated;
grant select on public.crew_actions to authenticated;
grant select on public.crew_decisions to authenticated;
grant select, insert, update, delete on public.crew_bots to service_role;
grant select, insert, update, delete on public.crew_messages to service_role;
grant select, insert, update, delete on public.crew_actions to service_role;
grant select, insert, update, delete on public.crew_decisions to service_role;

alter table public.crew_bots replica identity full;
alter table public.crew_messages replica identity full;
alter table public.crew_actions replica identity full;
alter table public.crew_decisions replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.crew_bots;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.crew_messages;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.crew_actions;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.crew_decisions;
  exception
    when duplicate_object then null;
  end;
end $$;
