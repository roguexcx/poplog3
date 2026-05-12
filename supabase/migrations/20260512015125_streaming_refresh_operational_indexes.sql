create index if not exists title_streaming_availability_refresh_candidates_idx
  on public.title_streaming_availability (
    country,
    cache_valid_until,
    source_confidence,
    stream_status
  );

create index if not exists title_streaming_availability_uncertain_idx
  on public.title_streaming_availability (
    country,
    inferred,
    available_abroad,
    source_confidence
  );

create index if not exists api_sync_logs_budget_idx
  on public.api_sync_logs (
    api_name,
    success,
    created_at desc
  );

create index if not exists user_titles_streaming_refresh_signal_idx
  on public.user_titles (
    tmdb_id,
    media_type,
    status,
    favorite
  );
