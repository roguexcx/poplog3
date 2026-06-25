ALTER TABLE `user_curadoria_preferences`
  ADD COLUMN `interface_language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN `catalog_language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN `availability_region` VARCHAR(16) NOT NULL DEFAULT 'BR';
