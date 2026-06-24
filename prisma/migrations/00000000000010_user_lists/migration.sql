-- AlterTable: adiciona username (slug de rota) em users
ALTER TABLE `users`
  ADD COLUMN `username` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `users_username_key` ON `users`(`username`);

-- CreateTable: user_lists (listas personalizadas do usuário)
CREATE TABLE `user_lists` (
  `id`          VARCHAR(191) NOT NULL,
  `user_id`     VARCHAR(191) NOT NULL,
  `short_id`    VARCHAR(16)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `slug`        VARCHAR(160) NOT NULL,
  `description` TEXT         NULL,
  `is_public`   BOOLEAN      NOT NULL DEFAULT false,
  `share_token` VARCHAR(32)  NULL,
  `position`    INTEGER      NOT NULL DEFAULT 0,
  `item_count`  INTEGER      NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL,

  UNIQUE INDEX `user_lists_short_id_key`(`short_id`),
  UNIQUE INDEX `user_lists_share_token_key`(`share_token`),
  UNIQUE INDEX `user_lists_user_id_name_key`(`user_id`, `name`),
  INDEX `user_lists_user_id_position_idx`(`user_id`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: user_list_items (vínculo lista ↔ título, por tmdbId+mediaType)
CREATE TABLE `user_list_items` (
  `id`         VARCHAR(191)              NOT NULL,
  `list_id`    VARCHAR(191)              NOT NULL,
  `tmdb_id`    INTEGER                   NOT NULL,
  `media_type` ENUM('movie', 'tv')      NOT NULL,
  `position`   INTEGER                   NOT NULL DEFAULT 0,
  `note`       TEXT                      NULL,
  `added_at`   DATETIME(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `user_list_items_list_id_tmdb_id_media_type_key`(`list_id`, `tmdb_id`, `media_type`),
  INDEX `user_list_items_list_id_position_idx`(`list_id`, `position`),
  INDEX `user_list_items_tmdb_id_media_type_idx`(`tmdb_id`, `media_type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_lists`
  ADD CONSTRAINT `user_lists_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `user_list_items`
  ADD CONSTRAINT `user_list_items_list_id_fkey`
  FOREIGN KEY (`list_id`) REFERENCES `user_lists`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
