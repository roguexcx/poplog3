CREATE TABLE IF NOT EXISTS `user_legal_consents` (
    `id` VARCHAR(191) NOT NULL,
    `anonymous_id` VARCHAR(128) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `schema_version` INTEGER NOT NULL DEFAULT 1,
    `terms_accepted` BOOLEAN NOT NULL DEFAULT false,
    `terms_version` VARCHAR(32) NOT NULL,
    `privacy_accepted` BOOLEAN NOT NULL DEFAULT false,
    `privacy_version` VARCHAR(32) NOT NULL,
    `analytics_enabled` BOOLEAN NOT NULL DEFAULT false,
    `ads_enabled` BOOLEAN NOT NULL DEFAULT false,
    `personalization_enabled` BOOLEAN NOT NULL DEFAULT false,
    `interface_language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
    `region` VARCHAR(16) NOT NULL DEFAULT 'BR',
    `source` VARCHAR(32) NULL,
    `record` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_legal_consents_anonymous_id_key`(`anonymous_id`),
    INDEX `user_legal_consents_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @user_legal_consents_fk_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME = 'user_legal_consents_user_id_fkey'
);

SET @user_legal_consents_fk_sql = IF(
    @user_legal_consents_fk_exists = 0,
    'ALTER TABLE `user_legal_consents` ADD CONSTRAINT `user_legal_consents_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1'
);

PREPARE user_legal_consents_fk_stmt FROM @user_legal_consents_fk_sql;
EXECUTE user_legal_consents_fk_stmt;
DEALLOCATE PREPARE user_legal_consents_fk_stmt;
