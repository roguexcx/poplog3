-- AddColumn: stale_at em poplog3_titles
-- Separa o ciclo de cache em dois limiares:
--   expiresAt: fim do fresh, início do stale-while-revalidate
--   staleAt:   fim do stale, início do expired (refresh síncrono obrigatório)
ALTER TABLE `poplog3_titles`
  ADD COLUMN `stale_at` DATETIME(3) NULL AFTER `expires_at`;

CREATE INDEX `poplog3_titles_stale_at_idx` ON `poplog3_titles`(`stale_at`);
