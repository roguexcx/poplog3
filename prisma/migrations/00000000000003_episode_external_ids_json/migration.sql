-- AlterTable: add external_ids_json to poplog3_episodes
-- Stores TVDB, Trakt, IMDb IDs per episode for stable marking, deduplication and future migrations.
ALTER TABLE `poplog3_episodes`
    ADD COLUMN `external_ids_json` JSON NULL;
