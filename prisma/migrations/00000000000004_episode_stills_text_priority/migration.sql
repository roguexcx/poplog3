ALTER TABLE `poplog3_episodes`
  ADD COLUMN `still_url` VARCHAR(1024) NULL,
  ADD COLUMN `still_source` VARCHAR(64) NULL,
  ADD COLUMN `still_width` INT NULL,
  ADD COLUMN `still_height` INT NULL,
  ADD COLUMN `still_language` VARCHAR(32) NULL,
  ADD COLUMN `absolute_number` INT NULL,
  ADD COLUMN `title_language` VARCHAR(32) NULL,
  ADD COLUMN `overview_language` VARCHAR(32) NULL,
  ADD COLUMN `original_title` VARCHAR(512) NULL,
  ADD COLUMN `original_overview` TEXT NULL,
  ADD COLUMN `source_priority` JSON NULL,
  ADD COLUMN `image_candidates_json` JSON NULL,
  ADD COLUMN `text_candidates_json` JSON NULL;
