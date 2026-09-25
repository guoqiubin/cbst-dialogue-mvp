-- Knowledge sources and entries are only accessed through server-side APIs.
-- This keeps unpublished course material and original files out of browser access.
create table if not exists public.knowledge_sources (
  id uuid primary key,
  title text not null,
  source_type text not null check (source_type in ('pptx', 'pdf', 'docx', 'markdown', 'text', 'legacy')),
  storage_path text,
  extracted_text text not null default '',
  summary text not null default '',
  module_tags text[] not null default '{global}',
  status text not null default 'processing' check (status in ('processing', 'draft', 'published', 'retracted', 'deleted', 'failed')),
  entry_count integer not null default 0 check (entry_count >= 0),
  source_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  deleted_at timestamptz,
  purge_after timestamptz
);

create table if not exists public.knowledge_entries (
  id uuid primary key,
  source_id uuid not null references public.knowledge_sources (id) on delete cascade,
  title text not null,
  entry_type text not null check (entry_type in ('rule', 'case', 'term', 'safety', 'guidance')),
  module_tags text[] not null default '{global}',
  section_label text not null default '',
  content text not null,
  example text not null default '',
  citation_label text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'retracted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_sources_status_idx on public.knowledge_sources (status, updated_at desc);
create index if not exists knowledge_entries_source_idx on public.knowledge_entries (source_id);
create index if not exists knowledge_entries_status_idx on public.knowledge_entries (status);

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_entries enable row level security;

revoke all on table public.knowledge_sources from anon, authenticated;
revoke all on table public.knowledge_entries from anon, authenticated;
grant all on table public.knowledge_sources to service_role;
grant all on table public.knowledge_entries to service_role;

-- Uploaded originals stay private. Server-side requests use the service role;
-- no browser policy is intentionally granted for this V1 administrative bucket.
insert into storage.buckets (id, name, public)
values ('course-sources', 'course-sources', false)
on conflict (id) do update set public = false;

-- Add independent emotional-skills modules without touching
-- records already saved by existing training modules.
alter table public.user_progress
  drop constraint if exists user_progress_module_check;

alter table public.user_progress
  add constraint user_progress_module_check
  check (module in ('dialogue', 'cognitive', 'logic-training', 'empathy'));
