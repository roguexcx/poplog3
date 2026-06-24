-- Cache de dados financeiros (orçamento / bilheteria) por título.
-- Fonte primária: Wikidata (P2130 / P2142); fallback: infobox da Wikipedia PT/EN.
CREATE TABLE `poplog_title_financials_cache` (
  `id` VARCHAR(191) NOT NULL,
  `imdb_id` VARCHAR(64) NOT NULL,
  `poplog_id` VARCHAR(191) NULL,
  `budget` BIGINT NULL,
  `revenue` BIGINT NULL,
  `wikidata_id` VARCHAR(32) NULL,
  `stale_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  `last_fetched_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `poplog_title_financials_cache_imdb_id_key`(`imdb_id`),
  INDEX `poplog_title_financials_cache_poplog_id_idx`(`poplog_id`),
  INDEX `poplog_title_financials_cache_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
