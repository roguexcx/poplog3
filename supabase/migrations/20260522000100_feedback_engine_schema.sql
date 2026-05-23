-- Feedback Engine Rework - additive schema foundation
--
-- This migration intentionally avoids removing legacy columns or uniqueness
-- constraints. The product still has old callers that depend on them.
--
-- Goals:
-- - Ensure user_title_feedback exists in local/dev environments.
-- - Add contextual/editorial fields needed by the global feedback engine.
-- - Add derived editorial fields to user_title_state.
-- - Stop the destructive negative-feedback trigger behavior without dropping
--   the trigger name yet.

-- -----------------------------------------------------------------------------
-- user_title_feedback
-- Explicit user preference/opinion records.
-- Raw feedback is preserved; conflicts are resolved in derived state.
-- -----------------------------------------------------------------------------

create table if not exists public.user_title_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  tmdb_id       integer not null,
  media_type    text not null check (media_type in ('movie', 'tv')),
  feedback_type text not null check (
    feedback_type in (
      'not_interested',
      'liked',
      'disliked',
      'hidden',
      'boosted',
      'dismissed_from_section'
    )
  ),
  weight     numeric not null default -1,
  reason     text,
  source     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type, feedback_type)
);

alter table public.user_title_feedback
  add column if not exists surface text,
  add column if not exists scope text not null default 'global',
  add column if not exists section_key text,
  add column if not exists expires_at timestamptz,
  add column if not exists active boolean not null default true,
  add column if not exists metadata jsonb not null default '{}',
  add column if not exists strength numeric,
  add column if not exists confidence numeric;

alter table public.user_title_feedback
  alter column scope set default 'global',
  alter column active set default true,
  alter column metadata set default '{}';

update public.user_title_feedback
set
  surface = case when surface = 'agenda' then 'radar' else surface end,
  scope = coalesce(scope, 'global'),
  active = coalesce(active, true),
  metadata = coalesce(metadata, '{}');

alter table public.user_title_feedback
  alter column scope set not null,
  alter column active set not null,
  alter column metadata set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_title_feedback_scope_check'
      and conrelid = 'public.user_title_feedback'::regclass
  ) then
    alter table public.user_title_feedback
      add constraint user_title_feedback_scope_check
      check (scope in ('global', 'surface', 'section', 'session'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_title_feedback_surface_check'
      and conrelid = 'public.user_title_feedback'::regclass
  ) then
    alter table public.user_title_feedback
      add constraint user_title_feedback_surface_check
      check (
        surface is null
        or surface in (
          'hero',
          'for_you',
          'radar',
          'acompanhando',
          'trending',
          'search',
          'title_page',
          'library',
          'contextual'
        )
      );
  end if;
end $$;

create index if not exists user_title_feedback_active_lookup_idx
  on public.user_title_feedback (user_id, tmdb_id, media_type, active);

create index if not exists user_title_feedback_user_type_active_idx
  on public.user_title_feedback (user_id, feedback_type, active, updated_at desc);

create index if not exists user_title_feedback_contextual_expiry_idx
  on public.user_title_feedback (user_id, surface, section_key, expires_at)
  where active = true
    and feedback_type = 'dismissed_from_section';

alter table public.user_title_feedback enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_title_feedback'
      and policyname = 'Users can read their title feedback'
  ) then
    create policy "Users can read their title feedback"
      on public.user_title_feedback
      for select
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_title_feedback'
      and policyname = 'Users can insert their title feedback'
  ) then
    create policy "Users can insert their title feedback"
      on public.user_title_feedback
      for insert
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_title_feedback'
      and policyname = 'Users can update their title feedback'
  ) then
    create policy "Users can update their title feedback"
      on public.user_title_feedback
      for update
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_title_feedback'
      and policyname = 'Users can delete their title feedback'
  ) then
    create policy "Users can delete their title feedback"
      on public.user_title_feedback
      for delete
      using ((select auth.uid()) = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.user_title_feedback to authenticated;
grant select, insert, update, delete on public.user_title_feedback to service_role;

create or replace function public.touch_user_title_feedback_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_title_feedback_updated_at
  on public.user_title_feedback;

create trigger touch_user_title_feedback_updated_at
  before update on public.user_title_feedback
  for each row
  execute function public.touch_user_title_feedback_updated_at();

-- -----------------------------------------------------------------------------
-- user_title_state
-- Fast derived read model for editorial decisions.
-- -----------------------------------------------------------------------------

alter table public.user_title_state
  add column if not exists editorial_affinity numeric not null default 0,
  add column if not exists editorial_penalty numeric not null default 0,
  add column if not exists editorial_score numeric not null default 0,
  add column if not exists has_negative_feedback boolean not null default false,
  add column if not exists is_hidden boolean not null default false,
  add column if not exists is_boosted boolean not null default false,
  add column if not exists last_feedback_type text,
  add column if not exists last_feedback_at timestamptz;

create index if not exists user_title_state_editorial_score_idx
  on public.user_title_state (user_id, editorial_score desc, updated_at desc);

create index if not exists user_title_state_feedback_flags_idx
  on public.user_title_state (user_id, has_negative_feedback, is_hidden, is_boosted);

-- -----------------------------------------------------------------------------
-- Non-destructive trigger compatibility shim
-- -----------------------------------------------------------------------------
--
-- Production currently has a trigger named
-- neutralize_negative_feedback_on_positive_title_state on user_titles.
-- The old function deleted not_interested/disliked/hidden rows when a title
-- became favorite/watchlist/watched/watching.
--
-- The feedback engine must preserve raw feedback. Conflict resolution now
-- belongs in derived state, not destructive database side effects.

create or replace function public.neutralize_negative_feedback_on_positive_title_state()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  return new;
end;
$$;
