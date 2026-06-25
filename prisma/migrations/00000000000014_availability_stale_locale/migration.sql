ALTER TABLE `catalog_availability`
  ADD COLUMN `provider_language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN `stale_until` DATETIME(3) NULL;

DROP INDEX `catalog_availability_imdb_id_trakt_id_provider_name_provider_key`
  ON `catalog_availability`;

CREATE UNIQUE INDEX `catalog_avail_identity_lang_uq`
  ON `catalog_availability`(`imdb_id`, `trakt_id`, `provider_name`, `provider_region`, `provider_language`, `provider_type`);

CREATE INDEX `catalog_avail_imdb_region_lang_idx`
  ON `catalog_availability`(`imdb_id`, `provider_region`, `provider_language`);

CREATE INDEX `catalog_avail_stale_until_idx`
  ON `catalog_availability`(`stale_until`);
