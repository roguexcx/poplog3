revoke all on table public.user_title_feedback from anon;
revoke truncate, references, trigger on table public.user_title_feedback from authenticated;
revoke truncate, references, trigger on table public.user_title_feedback from service_role;

grant select, insert, update, delete on table public.user_title_feedback to authenticated;
grant select on table public.user_title_feedback to service_role;
