-- AlterTable: adiciona primary_network_slug e networks_json em poplog3_titles
ALTER TABLE `poplog3_titles`
  ADD COLUMN `primary_network_slug` VARCHAR(191) NULL,
  ADD COLUMN `networks_json` JSON NULL;

-- Index para filtrar títulos por rede
CREATE INDEX `poplog3_titles_primary_network_slug_media_type_idx`
  ON `poplog3_titles`(`primary_network_slug`, `media_type`);
