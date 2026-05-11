create table if not exists public.user_title_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  media_type text not null check (media_type in ('movie', 'tv')),
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
  weight numeric not null default -1,
  reason text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tmdb_id, media_type, feedback_type)
);

create index if not exists user_title_feedback_user_idx
  on public.user_title_feedback (user_id, feedback_type, media_type, tmdb_id);

grant select, insert, update, delete on table public.user_title_feedback to authenticated;
grant select on table public.user_title_feedback to service_role;
revoke all on table public.user_title_feedback from anon;
revoke truncate, references, trigger on table public.user_title_feedback from authenticated;
revoke truncate, references, trigger on table public.user_title_feedback from service_role;

alter table public.user_title_feedback enable row level security;

drop policy if exists "Users can read their title feedback" on public.user_title_feedback;
create policy "Users can read their title feedback"
  on public.user_title_feedback
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their title feedback" on public.user_title_feedback;
create policy "Users can insert their title feedback"
  on public.user_title_feedback
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their title feedback" on public.user_title_feedback;
create policy "Users can update their title feedback"
  on public.user_title_feedback
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their title feedback" on public.user_title_feedback;
create policy "Users can delete their title feedback"
  on public.user_title_feedback
  for delete
  using ((select auth.uid()) = user_id);

create or replace function public.touch_user_title_feedback_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_user_title_feedback_updated_at on public.user_title_feedback;
create trigger touch_user_title_feedback_updated_at
before update on public.user_title_feedback
for each row
execute function public.touch_user_title_feedback_updated_at();

create or replace function public.neutralize_negative_feedback_on_positive_title_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (
    coalesce(new.favorite, false)
    or new.status in ('watchlist', 'watched', 'watching')
  ) then
    delete from public.user_title_feedback
    where user_id = new.user_id
      and tmdb_id = new.tmdb_id
      and media_type = new.media_type
      and feedback_type in ('not_interested', 'disliked', 'hidden');
  end if;

  return new;
end;
$$;

drop trigger if exists neutralize_negative_feedback_on_positive_title_state on public.user_titles;
create trigger neutralize_negative_feedback_on_positive_title_state
after insert or update on public.user_titles
for each row
execute function public.neutralize_negative_feedback_on_positive_title_state();
