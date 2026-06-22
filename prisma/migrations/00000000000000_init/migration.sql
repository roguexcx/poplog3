-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `name` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_titles` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `status` ENUM('watchlist', 'watching', 'watched', 'abandoned', 'fridge') NOT NULL,
    `rating` INTEGER NULL,
    `liked` BOOLEAN NULL,
    `favorite` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `abandoned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_titles_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_titles_tmdb_id_media_type_idx`(`tmdb_id`, `media_type`),
    UNIQUE INDEX `user_titles_user_id_tmdb_id_media_type_key`(`user_id`, `tmdb_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_watching` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `content_type` ENUM('serie', 'filme') NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `poster_path` VARCHAR(512) NULL,
    `backdrop_path` VARCHAR(512) NULL,
    `dominant_color` VARCHAR(64) NULL,
    `status` ENUM('watching', 'paused', 'abandoned', 'finished', 'watchlist') NOT NULL DEFAULT 'watching',
    `current_season` INTEGER NULL,
    `current_episode` INTEGER NULL,
    `total_seasons` INTEGER NULL,
    `total_episodes_season` INTEGER NULL,
    `episodes_watched` INTEGER NOT NULL DEFAULT 0,
    `next_episode_name` VARCHAR(512) NULL,
    `next_episode_duration` INTEGER NULL,
    `next_episode_air_date` DATETIME(3) NULL,
    `series_status` ENUM('returning', 'ended', 'canceled', 'hiatus', 'in_production') NULL,
    `new_episode_available` BOOLEAN NOT NULL DEFAULT false,
    `new_episode_available_since` DATETIME(3) NULL,
    `runtime` INTEGER NULL,
    `watch_progress_minutes` INTEGER NOT NULL DEFAULT 0,
    `streaming_platform` VARCHAR(191) NULL,
    `streaming_available_since` DATETIME(3) NULL,
    `available_on_vod` BOOLEAN NOT NULL DEFAULT false,
    `vod_available_since` DATETIME(3) NULL,
    `tmdb_rating` DECIMAL(3, 1) NULL,
    `user_rating` INTEGER NULL,
    `last_watched_at` DATETIME(3) NULL,
    `last_session_duration` INTEGER NULL,
    `sessions_last_7_days` INTEGER NOT NULL DEFAULT 0,
    `sessions_last_30_days` INTEGER NOT NULL DEFAULT 0,
    `average_session_gap_days` DECIMAL(5, 2) NULL,
    `is_marathon` BOOLEAN NOT NULL DEFAULT false,
    `priority_score` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `priority_last_calculated_at` DATETIME(3) NULL,
    `snoozed_until` DATETIME(3) NULL,
    `snooze_count` INTEGER NOT NULL DEFAULT 0,
    `hero_shown_count` INTEGER NOT NULL DEFAULT 0,
    `hero_last_shown_at` DATETIME(3) NULL,
    `rediscovery_eligible` BOOLEAN NOT NULL DEFAULT false,
    `added_to_watchlist_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `genres` JSON NULL,
    `year` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_watching_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_watching_user_id_priority_score_idx`(`user_id`, `priority_score`),
    INDEX `user_watching_user_id_last_watched_at_idx`(`user_id`, `last_watched_at`),
    UNIQUE INDEX `user_watching_user_id_content_id_key`(`user_id`, `content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_curadoria_state` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `content_type` ENUM('serie', 'filme') NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `poster_path` VARCHAR(512) NULL,
    `backdrop_path` VARCHAR(512) NULL,
    `status` ENUM('watching', 'paused', 'abandoned', 'finished', 'watchlist') NOT NULL DEFAULT 'watching',
    `runtime` INTEGER NULL,
    `tmdb_rating` DECIMAL(3, 1) NULL,
    `user_rating` INTEGER NULL,
    `added_to_watchlist_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `genres` JSON NULL,
    `year` INTEGER NULL,
    `priority_score` DECIMAL(8, 4) NOT NULL DEFAULT 0,
    `priority_last_calculated_at` DATETIME(3) NULL,
    `snoozed_until` DATETIME(3) NULL,
    `snooze_count` INTEGER NOT NULL DEFAULT 0,
    `hero_shown_count` INTEGER NOT NULL DEFAULT 0,
    `hero_last_shown_at` DATETIME(3) NULL,
    `dominant_color` VARCHAR(64) NULL,
    `rediscovery_eligible` BOOLEAN NOT NULL DEFAULT false,
    `new_episode_available` BOOLEAN NOT NULL DEFAULT false,
    `new_episode_available_since` DATETIME(3) NULL,
    `streaming_platform` VARCHAR(191) NULL,
    `streaming_available_since` DATETIME(3) NULL,
    `available_on_vod` BOOLEAN NOT NULL DEFAULT false,
    `vod_available_since` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_curadoria_state_user_id_idx`(`user_id`),
    INDEX `user_curadoria_state_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_curadoria_state_user_id_priority_score_idx`(`user_id`, `priority_score`),
    INDEX `user_curadoria_state_user_id_snoozed_until_idx`(`user_id`, `snoozed_until`),
    UNIQUE INDEX `user_curadoria_state_user_id_content_id_key`(`user_id`, `content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_events` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `user_events_user_id_tmdb_id_media_type_created_at_idx`(`user_id`, `tmdb_id`, `media_type`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `media_type` ENUM('movie', 'tv', 'season', 'episode') NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `season_number` SMALLINT NULL,
    `episode_number` SMALLINT NULL,
    `item_key` VARCHAR(191) NOT NULL,
    `rating` DECIMAL(3, 1) NOT NULL,
    `rating_source` ENUM('explicit', 'inferred', 'imported', 'system_estimate') NOT NULL DEFAULT 'explicit',
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_ratings_user_id_idx`(`user_id`),
    INDEX `user_ratings_media_type_tmdb_id_idx`(`media_type`, `tmdb_id`),
    UNIQUE INDEX `user_ratings_user_id_item_key_key`(`user_id`, `item_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_title_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `feedback_type` ENUM('not_interested', 'liked', 'disliked', 'hidden', 'boosted', 'dismissed_from_section') NOT NULL,
    `weight` DECIMAL(10, 4) NOT NULL DEFAULT -1,
    `reason` TEXT NULL,
    `source` VARCHAR(191) NULL,
    `surface` ENUM('hero', 'for_you', 'radar', 'acompanhando', 'trending', 'search', 'title_page', 'library', 'contextual') NULL,
    `scope` ENUM('global', 'surface', 'section', 'session') NOT NULL DEFAULT 'global',
    `section_key` VARCHAR(191) NULL,
    `expires_at` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NOT NULL,
    `strength` DECIMAL(10, 4) NULL,
    `confidence` DECIMAL(10, 4) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_title_feedback_user_id_tmdb_id_media_type_active_idx`(`user_id`, `tmdb_id`, `media_type`, `active`),
    INDEX `user_title_feedback_user_id_feedback_type_active_updated_at_idx`(`user_id`, `feedback_type`, `active`, `updated_at`),
    INDEX `user_title_feedback_user_id_surface_section_key_expires_at_idx`(`user_id`, `surface`, `section_key`, `expires_at`),
    UNIQUE INDEX `user_title_feedback_user_id_tmdb_id_media_type_feedback_type_key`(`user_id`, `tmdb_id`, `media_type`, `feedback_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_curadoria_signals` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `signal_type` ENUM('watched_episode', 'snoozed', 'clicked_hero', 'clicked_not_now', 'finished', 'abandoned', 'added_watchlist', 'removed_watchlist', 'rated') NOT NULL,
    `signal_value` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_curadoria_signals_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `user_curadoria_signals_user_id_content_id_signal_type_idx`(`user_id`, `content_id`, `signal_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_curadoria_preferences` (
    `user_id` VARCHAR(191) NOT NULL,
    `preferred_session_duration_minutes` INTEGER NOT NULL DEFAULT 60,
    `typical_watch_days` JSON NULL,
    `typical_watch_time_start` INTEGER NULL,
    `typical_watch_time_end` INTEGER NULL,
    `top_genres` JSON NULL,
    `top_platforms` JSON NULL,
    `avg_episodes_per_session` DECIMAL(4, 2) NULL,
    `prefers_short_content` BOOLEAN NOT NULL DEFAULT false,
    `binge_tendency_score` DECIMAL(3, 2) NOT NULL DEFAULT 0.5,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hero_spotlight_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `shown_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `position` INTEGER NULL,
    `score_at_time` DECIMAL(8, 4) NULL,
    `cta_clicked` VARCHAR(191) NULL,
    `time_visible_seconds` INTEGER NULL,

    INDEX `hero_spotlight_sessions_user_id_content_id_shown_at_idx`(`user_id`, `content_id`, `shown_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog3_titles` (
    `id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `title` VARCHAR(512) NULL,
    `original_title` VARCHAR(512) NULL,
    `overview` TEXT NULL,
    `poster_path` VARCHAR(512) NULL,
    `backdrop_path` VARCHAR(512) NULL,
    `release_date` DATE NULL,
    `first_air_date` DATE NULL,
    `last_air_date` DATE NULL,
    `year` INTEGER NULL,
    `runtime` INTEGER NULL,
    `episode_run_time` JSON NULL,
    `genres` JSON NULL,
    `popularity` DECIMAL(12, 4) NULL,
    `vote_average` DECIMAL(4, 2) NULL,
    `vote_count` INTEGER NULL,
    `number_of_episodes` INTEGER NULL,
    `number_of_seasons` INTEGER NULL,
    `original_language` VARCHAR(32) NULL,
    `tmdb_payload` JSON NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog3_titles_media_type_tmdb_id_idx`(`media_type`, `tmdb_id`),
    INDEX `poplog3_titles_title_idx`(`title`),
    UNIQUE INDEX `poplog3_titles_tmdb_id_media_type_key`(`tmdb_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `title_seasons` (
    `id` VARCHAR(191) NOT NULL,
    `series_tmdb_id` INTEGER NOT NULL,
    `season_number` INTEGER NOT NULL,
    `tmdb_season_id` INTEGER NULL,
    `name` VARCHAR(512) NULL,
    `overview` TEXT NULL,
    `poster_path` VARCHAR(512) NULL,
    `air_date` DATE NULL,
    `episode_count` INTEGER NULL,
    `vote_average` DECIMAL(4, 2) NULL,
    `tmdb_payload` JSON NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `title_seasons_series_tmdb_id_idx`(`series_tmdb_id`),
    UNIQUE INDEX `title_seasons_series_tmdb_id_season_number_key`(`series_tmdb_id`, `season_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog3_episodes` (
    `id` VARCHAR(191) NOT NULL,
    `series_tmdb_id` INTEGER NOT NULL,
    `season_number` INTEGER NOT NULL,
    `episode_number` INTEGER NOT NULL,
    `tmdb_episode_id` INTEGER NULL,
    `name` VARCHAR(512) NULL,
    `overview` TEXT NULL,
    `still_path` VARCHAR(512) NULL,
    `air_date` DATE NULL,
    `runtime` INTEGER NULL,
    `vote_average` DECIMAL(4, 2) NULL,
    `vote_count` INTEGER NULL,
    `production_code` VARCHAR(191) NULL,
    `episode_type` VARCHAR(64) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog3_episodes_series_tmdb_id_air_date_idx`(`series_tmdb_id`, `air_date`),
    INDEX `poplog3_episodes_series_tmdb_id_runtime_idx`(`series_tmdb_id`, `runtime`),
    UNIQUE INDEX `poplog3_episodes_series_tmdb_id_season_number_episode_number_key`(`series_tmdb_id`, `season_number`, `episode_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `title_external_ids` (
    `id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `imdb_id` VARCHAR(64) NULL,
    `tvdb_id` VARCHAR(64) NULL,
    `trakt_id` VARCHAR(64) NULL,
    `watchmode_id` INTEGER NULL,
    `motn_id` VARCHAR(64) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `title_external_ids_tmdb_id_media_type_key`(`tmdb_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `title_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `imdb_rating` DECIMAL(3, 1) NULL,
    `imdb_votes` INTEGER NULL,
    `rotten_tomatoes_score` INTEGER NULL,
    `metacritic_score` INTEGER NULL,
    `tmdb_rating` DECIMAL(4, 2) NULL,
    `poplog_score` DECIMAL(5, 2) NULL,
    `source_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `title_ratings_tmdb_id_media_type_key`(`tmdb_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_title_state` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `status` ENUM('watchlist', 'watching', 'watched', 'abandoned', 'fridge') NULL,
    `favorite` BOOLEAN NOT NULL DEFAULT false,
    `liked` BOOLEAN NULL,
    `computed_state` ENUM('watchlist', 'in_progress', 'up_to_date', 'completed', 'watched', 'abandoned', 'fridge') NULL,
    `watched_episodes` INTEGER NOT NULL DEFAULT 0,
    `aired_episodes` INTEGER NOT NULL DEFAULT 0,
    `total_episodes` INTEGER NULL,
    `progress_pct` SMALLINT NOT NULL DEFAULT 0,
    `next_season` SMALLINT NULL,
    `next_episode` SMALLINT NULL,
    `next_episode_air_date` DATE NULL,
    `last_watched_at` DATETIME(3) NULL,
    `watched_keys` JSON NOT NULL,
    `franchise_tmdb_id` INTEGER NULL,
    `franchise_name` VARCHAR(512) NULL,
    `franchise_watched` INTEGER NULL,
    `franchise_total` INTEGER NULL,
    `best_provider_name` VARCHAR(191) NULL,
    `best_provider_type` VARCHAR(64) NULL,
    `best_provider_logo` VARCHAR(512) NULL,
    `duration_sort_minutes` INTEGER NULL,
    `hydration_skipped` BOOLEAN NOT NULL DEFAULT false,
    `duration_sort_unavailable` BOOLEAN NOT NULL DEFAULT false,
    `editorial_affinity` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `editorial_penalty` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `editorial_score` DECIMAL(10, 4) NOT NULL DEFAULT 0,
    `has_negative_feedback` BOOLEAN NOT NULL DEFAULT false,
    `is_hidden` BOOLEAN NOT NULL DEFAULT false,
    `is_boosted` BOOLEAN NOT NULL DEFAULT false,
    `last_feedback_type` VARCHAR(191) NULL,
    `last_feedback_at` DATETIME(3) NULL,
    `last_event_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_title_state_user_id_idx`(`user_id`),
    INDEX `user_title_state_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_title_state_user_id_computed_state_idx`(`user_id`, `computed_state`),
    INDEX `user_title_state_user_id_duration_sort_minutes_idx`(`user_id`, `duration_sort_minutes`),
    INDEX `user_title_state_user_id_media_type_status_hydration_skipped_idx`(`user_id`, `media_type`, `status`, `hydration_skipped`),
    INDEX `user_title_state_user_id_media_type_status_duration_sort_una_idx`(`user_id`, `media_type`, `status`, `duration_sort_unavailable`),
    INDEX `user_title_state_user_id_editorial_score_updated_at_idx`(`user_id`, `editorial_score`, `updated_at`),
    INDEX `user_title_state_user_id_has_negative_feedback_is_hidden_is__idx`(`user_id`, `has_negative_feedback`, `is_hidden`, `is_boosted`),
    INDEX `user_title_state_user_id_status_last_event_at_idx`(`user_id`, `status`, `last_event_at`),
    UNIQUE INDEX `user_title_state_user_id_tmdb_id_media_type_key`(`user_id`, `tmdb_id`, `media_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_episodes` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `series_tmdb_id` INTEGER NOT NULL,
    `season_number` INTEGER NOT NULL,
    `episode_number` INTEGER NOT NULL,
    `watched_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `runtime_minutes` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_episodes_user_id_series_tmdb_id_idx`(`user_id`, `series_tmdb_id`),
    INDEX `user_episodes_series_tmdb_id_season_number_episode_number_idx`(`series_tmdb_id`, `season_number`, `episode_number`),
    UNIQUE INDEX `user_episodes_user_id_series_tmdb_id_season_number_episode_n_key`(`user_id`, `series_tmdb_id`, `season_number`, `episode_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rating_aggregates` (
    `id` VARCHAR(191) NOT NULL,
    `media_type` ENUM('movie', 'tv', 'season', 'episode') NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `season_number` SMALLINT NULL,
    `episode_number` SMALLINT NULL,
    `item_key` VARCHAR(191) NOT NULL,
    `average_rating` DECIMAL(4, 2) NULL,
    `explicit_avg_rating` DECIMAL(4, 2) NULL,
    `rating_count` INTEGER NOT NULL DEFAULT 0,
    `explicit_rating_count` INTEGER NOT NULL DEFAULT 0,
    `inferred_rating_count` INTEGER NOT NULL DEFAULT 0,
    `confidence_level` ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rating_aggregates_item_key_key`(`item_key`),
    INDEX `rating_aggregates_media_type_tmdb_id_idx`(`media_type`, `tmdb_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `streaming_providers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `tmdb_provider_id` INTEGER NULL,
    `logo_path` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `streaming_providers_tmdb_provider_id_key`(`tmdb_provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog3_title_availability` (
    `id` VARCHAR(191) NOT NULL,
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `provider_id` VARCHAR(191) NULL,
    `provider_name` VARCHAR(191) NOT NULL,
    `provider_logo_path` VARCHAR(512) NULL,
    `tmdb_provider_id` INTEGER NULL,
    `country` VARCHAR(8) NOT NULL,
    `availability_type` ENUM('streaming', 'rent', 'buy', 'free', 'ads') NOT NULL,
    `source` ENUM('tmdb', 'watchmode', 'motn') NOT NULL,
    `deep_link` TEXT NULL,
    `quality` VARCHAR(64) NULL,
    `raw_payload` JSON NULL,
    `last_synced_at` DATETIME(3) NULL,
    `provider_confidence` VARCHAR(64) NULL,
    `last_checked_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `fallback_checked_at` DATETIME(3) NULL,
    `fallback_result` VARCHAR(191) NULL,
    `fallback_source` VARCHAR(191) NULL,
    `next_fallback_allowed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog3_title_availability_media_type_tmdb_id_country_idx`(`media_type`, `tmdb_id`, `country`),
    INDEX `poplog3_title_availability_source_last_synced_at_idx`(`source`, `last_synced_at`),
    INDEX `poplog3_title_availability_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog3_availability_fallback_state` (
    `tmdb_id` INTEGER NOT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `region` VARCHAR(8) NOT NULL,
    `fallback_source` VARCHAR(64) NOT NULL,
    `fallback_checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fallback_result` VARCHAR(191) NOT NULL,
    `next_fallback_allowed_at` DATETIME(3) NOT NULL,
    `reason` TEXT NULL,
    `origin_endpoint` VARCHAR(191) NULL,
    `user_id` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `rows_count` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog3_availability_fallback_state_next_fallback_allowed_at_idx`(`next_fallback_allowed_at`),
    PRIMARY KEY (`tmdb_id`, `media_type`, `region`, `fallback_source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog3_premium_api_usage` (
    `id` VARCHAR(191) NOT NULL,
    `api` ENUM('omdb', 'watchmode', 'movieofthenight') NOT NULL,
    `period_day` DATE NOT NULL,
    `period_month` VARCHAR(7) NOT NULL,
    `used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endpoint` VARCHAR(191) NULL,
    `tmdb_id` INTEGER NULL,
    `media_type` ENUM('movie', 'tv') NULL,
    `region` VARCHAR(8) NULL,
    `user_id` VARCHAR(191) NULL,
    `action` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `status` VARCHAR(64) NOT NULL DEFAULT 'reserved',
    `daily_used` INTEGER NULL,
    `daily_limit` INTEGER NULL,
    `monthly_used` INTEGER NULL,
    `monthly_limit` INTEGER NULL,
    `error` TEXT NULL,

    INDEX `poplog3_premium_api_usage_api_period_day_idx`(`api`, `period_day`),
    INDEX `poplog3_premium_api_usage_api_period_month_idx`(`api`, `period_month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `continuity_section_cache` (
    `id` VARCHAR(191) NOT NULL,
    `section_key` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `region` VARCHAR(16) NULL,
    `language` VARCHAR(16) NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `continuity_section_cache_section_key_idx`(`section_key`),
    INDEX `continuity_section_cache_user_id_idx`(`user_id`),
    INDEX `continuity_section_cache_expires_at_idx`(`expires_at`),
    INDEX `continuity_section_cache_section_key_user_id_region_language_idx`(`section_key`, `user_id`, `region`, `language`, `expires_at`),
    UNIQUE INDEX `continuity_section_cache_section_key_user_id_region_language_key`(`section_key`, `user_id`, `region`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engine_api_call_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `ts` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `api` ENUM('tmdb', 'omdb', 'watchmode', 'motn', 'trakt', 'tvdb', 'balloonerismm') NOT NULL,
    `op` VARCHAR(191) NOT NULL,
    `origin` VARCHAR(191) NOT NULL,
    `media_type` ENUM('movie', 'tv') NULL,
    `tmdb_id` INTEGER NULL,
    `endpoint` TEXT NULL,
    `cache_status` ENUM('hit', 'miss', 'stale', 'forced', 'failed', 'skipped', 'none') NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `success` BOOLEAN NOT NULL,
    `http_status` INTEGER NULL,
    `error` TEXT NULL,
    `fallback_from` ENUM('tmdb', 'omdb', 'watchmode', 'motn', 'trakt', 'tvdb', 'balloonerismm') NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `engine_api_call_logs_ts_idx`(`ts`),
    INDEX `engine_api_call_logs_api_ts_idx`(`api`, `ts`),
    INDEX `engine_api_call_logs_origin_ts_idx`(`origin`, `ts`),
    INDEX `engine_api_call_logs_api_success_cache_status_ts_idx`(`api`, `success`, `cache_status`, `ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_usage_daily` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `day` DATE NOT NULL,
    `api` ENUM('tmdb', 'omdb', 'watchmode', 'motn', 'trakt', 'tvdb', 'balloonerismm') NOT NULL,
    `total_calls` INTEGER NOT NULL DEFAULT 0,
    `cache_hits` INTEGER NOT NULL DEFAULT 0,
    `errors` INTEGER NOT NULL DEFAULT 0,
    `avg_ms` INTEGER NOT NULL DEFAULT 0,
    `max_ms` INTEGER NOT NULL DEFAULT 0,
    `p95_ms` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `api_usage_daily_day_api_key`(`day`, `api`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catalog_availability` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `imdb_id` VARCHAR(64) NULL,
    `trakt_id` BIGINT NULL,
    `tmdb_id` BIGINT NULL,
    `media_type` ENUM('movie', 'tv') NOT NULL,
    `provider_name` VARCHAR(191) NOT NULL,
    `provider_region` VARCHAR(8) NOT NULL,
    `provider_type` ENUM('subscription', 'rent', 'buy', 'free', 'ads', 'unknown') NOT NULL,
    `provider_url` TEXT NULL,
    `provider_logo_url` TEXT NULL,
    `source` ENUM('tmdb', 'balloonerismm', 'watchmode', 'motn', 'local', 'manual', 'future_provider') NOT NULL,
    `source_confidence` ENUM('high', 'medium', 'low', 'predicted', 'stale', 'unverified') NOT NULL,
    `checked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `evidence_payload_hash` VARCHAR(191) NULL,
    `raw_payload_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `catalog_availability_imdb_id_provider_region_idx`(`imdb_id`, `provider_region`),
    INDEX `catalog_availability_trakt_id_provider_region_idx`(`trakt_id`, `provider_region`),
    INDEX `catalog_availability_expires_at_idx`(`expires_at`),
    INDEX `catalog_availability_source_source_confidence_idx`(`source`, `source_confidence`),
    UNIQUE INDEX `catalog_availability_imdb_id_trakt_id_provider_name_provider_key`(`imdb_id`, `trakt_id`, `provider_name`, `provider_region`, `provider_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ics_agenda_cache` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'main',
    `payload` JSON NOT NULL,
    `cached_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ics_agenda_cache_cached_at_idx`(`cached_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_titles` ADD CONSTRAINT `user_titles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_watching` ADD CONSTRAINT `user_watching_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_curadoria_state` ADD CONSTRAINT `user_curadoria_state_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_events` ADD CONSTRAINT `user_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_ratings` ADD CONSTRAINT `user_ratings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_title_feedback` ADD CONSTRAINT `user_title_feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_curadoria_signals` ADD CONSTRAINT `user_curadoria_signals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_curadoria_preferences` ADD CONSTRAINT `user_curadoria_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hero_spotlight_sessions` ADD CONSTRAINT `hero_spotlight_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_episodes` ADD CONSTRAINT `user_episodes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poplog3_title_availability` ADD CONSTRAINT `poplog3_title_availability_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `streaming_providers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poplog3_availability_fallback_state` ADD CONSTRAINT `poplog3_availability_fallback_state_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `poplog3_premium_api_usage` ADD CONSTRAINT `poplog3_premium_api_usage_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `continuity_section_cache` ADD CONSTRAINT `continuity_section_cache_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

