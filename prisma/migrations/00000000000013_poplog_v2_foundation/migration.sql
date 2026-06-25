-- POPLOG V2 foundation: IMDb canonical identity, localized catalog payloads,
-- asset indirection, editorial overrides and auditable admin actions.

UPDATE `engine_api_call_logs`
SET `fallback_from` = NULL
WHERE `fallback_from` IN ('omdb', 'tvdb');

UPDATE `engine_api_call_logs`
SET `api` = 'trakt'
WHERE `api` IN ('omdb', 'tvdb');

UPDATE `api_usage_daily`
SET `api` = 'trakt'
WHERE `api` IN ('omdb', 'tvdb');

UPDATE `poplog3_premium_api_usage`
SET `api` = 'watchmode'
WHERE `api` = 'omdb';

ALTER TABLE `engine_api_call_logs`
  MODIFY `api` ENUM('tmdb', 'watchmode', 'motn', 'trakt', 'balloonerismm', 'wikidata', 'wikipedia', 'justwatch') NOT NULL,
  MODIFY `fallback_from` ENUM('tmdb', 'watchmode', 'motn', 'trakt', 'balloonerismm', 'wikidata', 'wikipedia', 'justwatch') NULL;

ALTER TABLE `api_usage_daily`
  MODIFY `api` ENUM('tmdb', 'watchmode', 'motn', 'trakt', 'balloonerismm', 'wikidata', 'wikipedia', 'justwatch') NOT NULL;

ALTER TABLE `poplog3_premium_api_usage`
  MODIFY `api` ENUM('watchmode', 'movieofthenight') NOT NULL;

CREATE INDEX `poplog3_titles_imdb_slug_idx` ON `poplog3_titles`(`imdb_id`, `slug`);
CREATE INDEX `poplog3_titles_imdb_source_idx` ON `poplog3_titles`(`imdb_id`, `source`);
CREATE INDEX `title_external_ids_imdb_idx` ON `title_external_ids`(`imdb_id`);
CREATE INDEX `title_external_ids_trakt_idx` ON `title_external_ids`(`trakt_id`);
CREATE INDEX `title_external_ids_watchmode_idx` ON `title_external_ids`(`watchmode_id`);
CREATE INDEX `title_external_ids_motn_idx` ON `title_external_ids`(`motn_id`);

CREATE TABLE `title_source_identities` (
  `source` VARCHAR(64) NOT NULL,
  `external_id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `media_type` ENUM('movie', 'tv') NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`source`, `external_id`),
  INDEX `title_source_identities_imdb_idx`(`imdb_id`),
  INDEX `title_source_identities_imdb_source_idx`(`imdb_id`, `source`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `title_translations` (
  `imdb_id` VARCHAR(64) NOT NULL,
  `language` VARCHAR(16) NOT NULL,
  `region` VARCHAR(16) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `overview` TEXT NULL,
  `tagline` VARCHAR(512) NULL,
  `slug` VARCHAR(191) NULL,
  `aliases` JSON NULL,
  `source` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`imdb_id`, `language`, `region`),
  INDEX `title_translations_imdb_language_idx`(`imdb_id`, `language`),
  INDEX `title_translations_language_region_idx`(`language`, `region`),
  INDEX `title_translations_slug_language_region_idx`(`slug`, `language`, `region`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `title_aliases` (
  `id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `media_type` ENUM('movie', 'tv') NULL,
  `language` VARCHAR(16) NULL,
  `region` VARCHAR(16) NULL,
  `value` VARCHAR(512) NOT NULL,
  `normalized_value` VARCHAR(512) NOT NULL,
  `source` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `title_aliases_imdb_idx`(`imdb_id`),
  INDEX `title_aliases_normalized_locale_idx`(`normalized_value`(191), `language`, `region`),
  INDEX `title_aliases_imdb_locale_idx`(`imdb_id`, `language`, `region`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `title_assets` (
  `id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `language` VARCHAR(16) NULL,
  `region` VARCHAR(16) NULL,
  `asset_key` VARCHAR(512) NULL,
  `source_url` TEXT NULL,
  `source` VARCHAR(64) NULL,
  `width` INTEGER NULL,
  `height` INTEGER NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT false,
  `is_override` BOOLEAN NOT NULL DEFAULT false,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `title_assets_imdb_type_locale_idx`(`imdb_id`, `type`, `language`, `region`),
  INDEX `title_assets_imdb_type_primary_idx`(`imdb_id`, `type`, `is_primary`),
  INDEX `title_assets_asset_key_idx`(`asset_key`(191))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `title_overrides` (
  `id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `field` VARCHAR(64) NOT NULL,
  `language` VARCHAR(16) NULL,
  `region` VARCHAR(16) NULL,
  `value_json` JSON NOT NULL,
  `previous_json` JSON NULL,
  `reason` TEXT NULL,
  `actor_user_id` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `cache_key` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `title_overrides_imdb_field_locale_idx`(`imdb_id`, `field`, `language`, `region`),
  INDEX `title_overrides_actor_created_idx`(`actor_user_id`, `created_at`),
  INDEX `title_overrides_active_idx`(`active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `admin_action_logs` (
  `id` VARCHAR(191) NOT NULL,
  `actor_user_id` VARCHAR(191) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` VARCHAR(191) NOT NULL,
  `field` VARCHAR(64) NULL,
  `language` VARCHAR(16) NULL,
  `region` VARCHAR(16) NULL,
  `previous_json` JSON NULL,
  `next_json` JSON NULL,
  `action` VARCHAR(64) NOT NULL,
  `reason` TEXT NULL,
  `cache_key` VARCHAR(512) NULL,
  `cache_invalidated` BOOLEAN NOT NULL DEFAULT false,
  `metadata` JSON NULL,
  `ip` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `admin_action_logs_entity_idx`(`entity_type`, `entity_id`),
  INDEX `admin_action_logs_actor_created_idx`(`actor_user_id`, `created_at`),
  INDEX `admin_action_logs_entity_field_locale_idx`(`entity_id`, `field`, `language`, `region`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_library_identities` (
  `user_id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `media_type` ENUM('movie', 'tv') NULL,
  `status` VARCHAR(64) NULL,
  `source` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`, `imdb_id`),
  INDEX `user_library_identities_user_status_idx`(`user_id`, `status`),
  INDEX `user_library_identities_imdb_idx`(`imdb_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
