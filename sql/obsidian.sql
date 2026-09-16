-- Obsidian MVP — admin thinking desk (threads + messages).
-- Apply in Supabase → SQL Editor on the Internal project (prod, then staging if used).
-- Apply order: this file only (idempotent). After it succeeds, deploy Edge Functions:
--   obsidian-chat, obsidian-handoff, obsidian-reply
-- Then enable Realtime for these tables in Dashboard if the publication block below is skipped.
--
-- Admin gate matches src/lib/adminAuth.ts (ADMIN_EMAIL). JWT `email` is the GoTrue claim,
-- not user_metadata. service_role bypasses RLS (internal app often uses that key).

create extension if not exists pgcrypto;

create table if not exists public.obsidian_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New thread',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.obsidian_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.obsidian_threads (id) on delete cascade,
  role text not null,
  content text not null default '',
  status text,
  created_at timestamptz not null default now(),
  constraint obsidian_messages_role_check
    check (role in ('user', 'chatgpt', 'ace', 'moti', 'jack', 'queen', 'nigus')),
  constraint obsidian_messages_status_check
    check (status is null or status in ('pending', 'done', 'blocked', 'failed'))
);

create index if not exists obsidian_messages_thread_id_created_at_idx
  on public.obsidian_messages (thread_id, created_at);

create index if not exists obsidian_threads_updated_at_idx
  on public.obsidian_threads (updated_at desc);

create or replace function public.obsidian_touch_thread()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.obsidian_threads
    set updated_at = now()
    where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists obsidian_messages_touch_thread on public.obsidian_messages;
create trigger obsidian_messages_touch_thread
  after insert on public.obsidian_messages
  for each row
  execute procedure public.obsidian_touch_thread();

alter table public.obsidian_threads enable row level security;
alter table public.obsidian_messages enable row level security;

drop policy if exists obsidian_threads_admin_all on public.obsidian_threads;
create policy obsidian_threads_admin_all
  on public.obsidian_threads
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

drop policy if exists obsidian_messages_admin_all on public.obsidian_messages;
create policy obsidian_messages_admin_all
  on public.obsidian_messages
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'dev@afaantech.com');

revoke all on public.obsidian_threads from anon, public;
revoke all on public.obsidian_messages from anon, public;
grant select, insert, update, delete on public.obsidian_threads to authenticated, service_role;
grant select, insert, update, delete on public.obsidian_messages to authenticated, service_role;

alter table public.obsidian_messages replica identity full;
alter table public.obsidian_threads replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.obsidian_messages;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.obsidian_threads;
  exception
    when duplicate_object then null;
  end;
end $$;
