CREATE TABLE `catalog_localizations` (
    `id` VARCHAR(191) NOT NULL,
    `poplog_id` VARCHAR(191) NOT NULL,
    `language` VARCHAR(16) NOT NULL,
    `title` VARCHAR(512) NULL,
    `overview` TEXT NULL,
    `tagline` VARCHAR(512) NULL,
    `source` VARCHAR(64) NULL,
    `hydrated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `catalog_localizations_language_idx`(`language`),
    INDEX `catalog_localizations_source_idx`(`source`),
    UNIQUE INDEX `catalog_localizations_poplog_id_language_key`(`poplog_id`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
