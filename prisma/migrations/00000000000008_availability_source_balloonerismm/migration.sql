-- AlterEnum: adiciona 'balloonerismm' ao enum AvailabilitySource
ALTER TABLE `poplog3_title_availability`
  MODIFY COLUMN `source` ENUM('tmdb', 'watchmode', 'motn', 'balloonerismm') NOT NULL;
