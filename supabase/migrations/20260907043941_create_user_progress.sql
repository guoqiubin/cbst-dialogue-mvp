create table if not exists public.user_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null check (module in ('dialogue', 'cognitive', 'logic-training')),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, module)
);

alter table public.user_progress enable row level security;

revoke all on table public.user_progress from anon;
grant select, insert, update, delete on table public.user_progress to authenticated;

create policy "Users can view their own progress"
on public.user_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own progress"
on public.user_progress
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own progress"
on public.user_progress
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own progress"
on public.user_progress
for delete
to authenticated
using ((select auth.uid()) = user_id);
