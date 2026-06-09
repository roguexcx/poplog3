alter table poplog3_titles
  add column trakt_id bigint null after tmdb_id,
  add column imdb_id varchar(64) null after trakt_id,
  add column slug varchar(191) null after imdb_id,
  add column source_payload json null after tmdb_payload,
  add column cache_status varchar(32) not null default 'miss' after source_payload,
  add column source varchar(32) not null default 'trakt' after cache_status,
  add column source_version varchar(64) not null default 'trakt-v2' after source,
  add column last_fetched_at datetime(3) null after source_version,
  add column expires_at datetime(3) null after last_fetched_at;

create unique index poplog3_titles_trakt_id_media_type_key
  on poplog3_titles (trakt_id, media_type);

create unique index poplog3_titles_imdb_id_media_type_key
  on poplog3_titles (imdb_id, media_type);

create index poplog3_titles_slug_media_type_idx
  on poplog3_titles (slug, media_type);

create index poplog3_titles_media_type_expires_at_idx
  on poplog3_titles (media_type, expires_at);

create index poplog3_titles_cache_status_idx
  on poplog3_titles (cache_status);

create table poplog_refresh_queue (
  id bigint not null auto_increment,
  cache_key varchar(191) not null,
  kind varchar(64) not null,
  media_type enum('movie','tv') null,
  poplog_id varchar(191) null,
  trakt_id bigint null,
  imdb_id varchar(64) null,
  slug varchar(191) null,
  status varchar(32) not null default 'queued',
  priority int not null default 100,
  attempts int not null default 0,
  locked_until datetime(3) null,
  run_after datetime(3) not null default current_timestamp(3),
  last_error text null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null,
  primary key (id),
  unique key poplog_refresh_queue_cache_key_kind_key (cache_key, kind),
  key poplog_refresh_queue_status_run_after_priority_idx (status, run_after, priority),
  key poplog_refresh_queue_locked_until_idx (locked_until),
  key poplog_refresh_queue_trakt_id_media_type_idx (trakt_id, media_type),
  key poplog_refresh_queue_imdb_id_media_type_idx (imdb_id, media_type)
) default character set utf8mb4 collate utf8mb4_unicode_ci;
