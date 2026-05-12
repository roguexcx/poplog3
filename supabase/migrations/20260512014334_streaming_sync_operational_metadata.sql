alter table public.api_sync_logs
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

create index if not exists api_sync_logs_metadata_gin_idx
  on public.api_sync_logs using gin (metadata_json);
