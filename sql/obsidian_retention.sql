-- Apply after sql/obsidian.sql. Daily job is obsidian-purge-stale or
-- select public.obsidian_purge_stale_threads(false);

alter table public.obsidian_threads
  add column if not exists keep boolean not null default false;

alter table public.obsidian_threads
  add column if not exists kept_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'obsidian_threads_keep_check'
  ) then
    alter table public.obsidian_threads
      add constraint obsidian_threads_keep_check
      check ((keep = false and kept_at is null) or (keep = true and kept_at is not null));
  end if;
end $$;

create or replace function public.obsidian_purge_stale_threads(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  n int;
  dry boolean := coalesce(p_dry_run, false);
begin
  select array_agg(t.id)
    into ids
  from public.obsidian_threads t
  where coalesce(t.keep, false) = false
    and greatest(
      t.updated_at,
      coalesce(
        (select max(m.created_at) from public.obsidian_messages m where m.thread_id = t.id),
        t.updated_at
      )
    ) < now() - interval '7 days';

  ids := coalesce(ids, '{}'::uuid[]);
  n := cardinality(ids);

  if dry = false and n > 0 then
    delete from public.obsidian_threads where id = any (ids);
  end if;

  return jsonb_build_object(
    'dry_run', dry,
    'deleted', case when dry then 0 else n end,
    'matched', n,
    'thread_ids', to_jsonb(ids)
  );
end;
$$;

comment on function public.obsidian_purge_stale_threads(boolean) is
  'Delete Obsidian threads with keep=false whose last activity (updated_at or newest message) is older than 7 days. Messages cascade. Pass true to preview.';

revoke all on function public.obsidian_purge_stale_threads(boolean) from public, anon, authenticated;
grant execute on function public.obsidian_purge_stale_threads(boolean) to service_role;
