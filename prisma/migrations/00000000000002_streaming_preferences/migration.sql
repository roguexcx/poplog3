-- AlterTable
ALTER TABLE `streaming_providers`
    ADD COLUMN `provider_slug` VARCHAR(191) NULL,
    ADD COLUMN `country` VARCHAR(8) NOT NULL DEFAULT 'BR',
    ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `user_streaming_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `provider_id` VARCHAR(191) NOT NULL,
    `country` VARCHAR(8) NOT NULL DEFAULT 'BR',
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `priority_order` INTEGER NOT NULL DEFAULT 999,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_streaming_preferences_user_id_provider_id_country_key`(`user_id`, `provider_id`, `country`),
    INDEX `user_streaming_preferences_provider_id_idx`(`provider_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_streaming_preferences` ADD CONSTRAINT `user_streaming_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_streaming_preferences` ADD CONSTRAINT `user_streaming_preferences_provider_id_fkey` FOREIGN KEY (`provider_id`) REFERENCES `streaming_providers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
