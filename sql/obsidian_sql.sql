-- Read-only SQL runner for Obsidian (admin thinking desk).
-- Called by obsidian-chat via service_role only. Apply on prod, then staging.
-- Pair with Edge Function deploy: obsidian-chat.
-- Also creates analytics-safe views used by that function.

create or replace function public.obsidian_exec_readonly_sql(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  q text;
  result jsonb;
begin
  q := btrim(coalesce(p_sql, ''));
  q := regexp_replace(q, ';+\s*$', '');
  if q = '' then
    raise exception 'empty sql';
  end if;
  if char_length(q) > 8000 then
    raise exception 'sql too long';
  end if;
  if position(';' in q) > 0 then
    raise exception 'one statement only';
  end if;
  if q !~* '^\s*(with|select)([^[:alnum:]_]|$)' then
    raise exception 'read-only SELECT/WITH only';
  end if;
  if q ~* '(^|[^[:alnum:]_])(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|comment|listen|notify|reindex|cluster|execute|security|pg_sleep|dblink|lo_|pg_read|pg_write|set_config|pg_terminate|pg_reload|load_file|into[[:space:]]+outfile)([^[:alnum:]_]|$)' then
    raise exception 'forbidden keyword';
  end if;

  execute
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (' || q || ') as inner_q limit 200) as t'
    into result;

  return jsonb_build_object(
    'row_count', jsonb_array_length(result),
    'rows', result
  );
end;
$$;

comment on function public.obsidian_exec_readonly_sql(text) is
  'Obsidian desk: run one read-only SELECT, cap 200 rows. service_role only.';

revoke all on function public.obsidian_exec_readonly_sql(text) from public, anon, authenticated;
grant execute on function public.obsidian_exec_readonly_sql(text) to service_role;

-- security_invoker off so obsidian_exec_readonly_sql can read the base tables.
create or replace view public.obsidian_users_analytics
with (security_invoker = false) as
select *
from public.users
where coalesce(exclude_from_analytics, false) = false;

create or replace view public.obsidian_events_analytics
with (security_invoker = false) as
select e.*
from public.analytics_events e
where e.user_id is null
   or e.user_id in (select id from public.obsidian_users_analytics);

revoke all on public.obsidian_users_analytics from public, anon, authenticated;
revoke all on public.obsidian_events_analytics from public, anon, authenticated;
grant select on public.obsidian_users_analytics to service_role;
grant select on public.obsidian_events_analytics to service_role;
