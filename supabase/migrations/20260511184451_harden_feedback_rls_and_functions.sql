-- Harden feedback/user state RLS policies and helper functions.

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

revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.rls_auto_enable() from public;

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

drop policy if exists "Users can read own titles" on public.user_titles;
create policy "Users can read own titles"
  on public.user_titles
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own titles" on public.user_titles;
create policy "Users can insert own titles"
  on public.user_titles
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own titles" on public.user_titles;
create policy "Users can update own titles"
  on public.user_titles
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own titles" on public.user_titles;
create policy "Users can delete own titles"
  on public.user_titles
  for delete
  using ((select auth.uid()) = user_id);

drop policy if exists "select own episodes" on public.episode_progress;
create policy "select own episodes"
  on public.episode_progress
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists "insert own episodes" on public.episode_progress;
create policy "insert own episodes"
  on public.episode_progress
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "update own episodes" on public.episode_progress;
create policy "update own episodes"
  on public.episode_progress
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "delete own episodes" on public.episode_progress;
create policy "delete own episodes"
  on public.episode_progress
  for delete
  using ((select auth.uid()) = user_id);
