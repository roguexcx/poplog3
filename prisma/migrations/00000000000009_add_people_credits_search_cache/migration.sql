-- CreateTable
CREATE TABLE `poplog_people_cache` (
    `id` VARCHAR(191) NOT NULL,
    `person_id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'trakt',
    `source_version` VARCHAR(64) NOT NULL DEFAULT 'people-v1',
    `trakt_id` BIGINT NULL,
    `trakt_slug` VARCHAR(191) NULL,
    `tmdb_id` INTEGER NULL,
    `imdb_id` VARCHAR(64) NULL,
    `name` VARCHAR(512) NOT NULL,
    `original_name` VARCHAR(512) NULL,
    `profile_image` VARCHAR(1024) NULL,
    `image_candidates_json` JSON NULL,
    `images_expires_at` DATETIME(3) NULL,
    `payload` JSON NOT NULL,
    `trakt_payload` JSON NULL,
    `balloon_payload` JSON NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    `region` VARCHAR(8) NOT NULL DEFAULT 'BR',
    `stale_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `last_fetched_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `poplog_people_cache_person_id_key`(`person_id`),
    UNIQUE INDEX `poplog_people_cache_trakt_id_key`(`trakt_id`),
    UNIQUE INDEX `poplog_people_cache_tmdb_id_key`(`tmdb_id`),
    UNIQUE INDEX `poplog_people_cache_imdb_id_key`(`imdb_id`),
    INDEX `poplog_people_cache_trakt_slug_idx`(`trakt_slug`),
    INDEX `poplog_people_cache_expires_at_idx`(`expires_at`),
    INDEX `poplog_people_cache_stale_at_idx`(`stale_at`),
    INDEX `poplog_people_cache_images_expires_at_idx`(`images_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog_person_credits_cache` (
    `id` VARCHAR(191) NOT NULL,
    `person_id` VARCHAR(191) NOT NULL,
    `acting` JSON NULL,
    `directing` JSON NULL,
    `writing` JSON NULL,
    `producing` JSON NULL,
    `other_crew` JSON NULL,
    `payload` JSON NOT NULL,
    `source_coverage` JSON NULL,
    `language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    `region` VARCHAR(8) NOT NULL DEFAULT 'BR',
    `stale_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `last_fetched_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog_person_credits_cache_expires_at_idx`(`expires_at`),
    INDEX `poplog_person_credits_cache_stale_at_idx`(`stale_at`),
    UNIQUE INDEX `poplog_person_credits_cache_person_id_language_region_key`(`person_id`, `language`, `region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `poplog_search_cache` (
    `id` VARCHAR(191) NOT NULL,
    `query` VARCHAR(512) NOT NULL,
    `query_normalized` VARCHAR(512) NOT NULL,
    `query_hash` VARCHAR(64) NOT NULL,
    `query_type` ENUM('text', 'imdb', 'tmdb', 'trakt', 'slug') NOT NULL DEFAULT 'text',
    `language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    `region` VARCHAR(8) NOT NULL DEFAULT 'BR',
    `results` JSON NOT NULL,
    `result_count` INTEGER NOT NULL DEFAULT 0,
    `source_coverage` JSON NULL,
    `stale_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `last_fetched_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `poplog_search_cache_query_normalized_idx`(`query_normalized`(191)),
    INDEX `poplog_search_cache_expires_at_idx`(`expires_at`),
    INDEX `poplog_search_cache_stale_at_idx`(`stale_at`),
    UNIQUE INDEX `poplog_search_cache_query_hash_query_type_language_region_key`(`query_hash`, `query_type`, `language`, `region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

