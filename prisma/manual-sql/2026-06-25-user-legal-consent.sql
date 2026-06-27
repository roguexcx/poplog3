-- Manual, isolated migration for the legal consent table.
-- Apply with: `mysql ... < prisma/migrations/manual/2026-06-25-user-legal-consent.sql`
-- or run `npm run db:push` (prisma db push) which syncs only additive schema changes.
-- The /api/legal/consent route degrades gracefully (persisted:false) until this runs,
-- so localStorage stays the source of truth for consent in the meantime.

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

ALTER TABLE `user_legal_consents`
    ADD CONSTRAINT `user_legal_consents_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
