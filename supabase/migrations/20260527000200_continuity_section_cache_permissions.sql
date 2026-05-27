-- continuity_section_cache is an internal backend cache.
-- Only service_role should read/write it; frontend clients must not access it.

revoke all on table public.continuity_section_cache from anon;
revoke all on table public.continuity_section_cache from authenticated;

grant select, insert, update, delete on table public.continuity_section_cache to service_role;
