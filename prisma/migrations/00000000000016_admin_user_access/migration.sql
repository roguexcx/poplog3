ALTER TABLE `users`
  ADD COLUMN `role` ENUM('user', 'admin', 'master') NOT NULL DEFAULT 'user',
  ADD COLUMN `access_status` ENUM('active', 'blocked') NOT NULL DEFAULT 'active',
  ADD COLUMN `blocked_at` DATETIME(3) NULL,
  ADD COLUMN `blocked_reason` TEXT NULL,
  ADD COLUMN `admin_permissions` JSON NULL,
  ADD COLUMN `last_admin_action_at` DATETIME(3) NULL;

CREATE INDEX `users_role_idx` ON `users`(`role`);
CREATE INDEX `users_access_status_idx` ON `users`(`access_status`);
