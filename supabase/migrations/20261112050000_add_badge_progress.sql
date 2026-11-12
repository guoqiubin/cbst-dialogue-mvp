-- Add the listening module to cloud progress and store only aggregated badge activity.
-- No exercise content is copied into the badge system.
alter table public.user_progress
  drop constraint if exists user_progress_module_check;

alter table public.user_progress
  add constraint user_progress_module_check
  check (module in ('dialogue', 'cognitive', 'logic-training', 'empathy', 'emotion', 'listening'));

create table if not exists public.user_badge_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  module_counts jsonb not null default '{}'::jsonb,
  total_completed integer not null default 0 check (total_completed >= 0),
  seen_modules text[] not null default '{}',
  event_keys text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists user_badge_progress_updated_idx
  on public.user_badge_progress (updated_at desc);

alter table public.user_badge_progress enable row level security;

revoke all on table public.user_badge_progress from anon, authenticated;
grant select on table public.user_badge_progress to authenticated;

create policy "Users can view their own badge progress"
on public.user_badge_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

-- The function determines the current user from the verified JWT. It accepts no
-- user id, so a caller cannot record progress for another account.
create or replace function public.record_badge_completion(p_module text, p_event_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_progress public.user_badge_progress;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_module not in ('dialogue', 'cognitive', 'logic-training', 'empathy', 'emotion', 'listening') then
    raise exception 'Unsupported training module';
  end if;

  if coalesce(length(trim(p_event_key)), 0) < 8 or length(p_event_key) > 120 then
    raise exception 'Invalid completion key';
  end if;

  insert into public.user_badge_progress (user_id, module_counts, total_completed, seen_modules, event_keys)
  values (
    v_user_id,
    jsonb_build_object(p_module, 1),
    1,
    array[p_module],
    array[p_event_key]
  )
  on conflict (user_id) do update
  set module_counts = jsonb_set(
        public.user_badge_progress.module_counts,
        array[p_module],
        to_jsonb(coalesce((public.user_badge_progress.module_counts ->> p_module)::integer, 0) + 1),
        true
      ),
      total_completed = public.user_badge_progress.total_completed + 1,
      seen_modules = case
        when p_module = any(public.user_badge_progress.seen_modules) then public.user_badge_progress.seen_modules
        else array_append(public.user_badge_progress.seen_modules, p_module)
      end,
      event_keys = case
        when cardinality(public.user_badge_progress.event_keys) >= 300
          then array_append(public.user_badge_progress.event_keys[2:300], p_event_key)
        else array_append(public.user_badge_progress.event_keys, p_event_key)
      end,
      updated_at = now()
  where not (p_event_key = any(public.user_badge_progress.event_keys));

  select * into v_progress
  from public.user_badge_progress
  where user_id = v_user_id;

  return jsonb_build_object(
    'moduleCounts', v_progress.module_counts,
    'totalCompleted', v_progress.total_completed,
    'seenModules', v_progress.seen_modules,
    'updatedAt', v_progress.updated_at
  );
end;
$$;

revoke all on function public.record_badge_completion(text, text) from public;
grant execute on function public.record_badge_completion(text, text) to authenticated;
