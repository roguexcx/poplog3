-- Provider original permanece em `name`; as colunas abaixo guardam apenas a
-- identidade derivada para busca, agrupamento e preferências.
ALTER TABLE `streaming_providers`
  ADD COLUMN `normalized_name` VARCHAR(191) NULL,
  ADD COLUMN `root_key` VARCHAR(96) NULL,
  ADD COLUMN `root_name` VARCHAR(191) NULL,
  ADD COLUMN `family_key` VARCHAR(96) NULL,
  ADD COLUMN `family_name` VARCHAR(191) NULL,
  ADD COLUMN `variant_key` VARCHAR(96) NULL,
  ADD COLUMN `variant_name` VARCHAR(191) NULL,
  ADD COLUMN `access_kind` VARCHAR(32) NULL,
  ADD COLUMN `default_priority` INTEGER NOT NULL DEFAULT 1000;

CREATE INDEX `streaming_providers_country_root_key_variant_key_idx`
  ON `streaming_providers`(`country`, `root_key`, `variant_key`);
CREATE INDEX `streaming_providers_family_key_idx`
  ON `streaming_providers`(`family_key`);

-- Fallback seguro para linhas históricas: nenhuma origem é descartada e qualquer
-- provider ainda não catalogado continua selecionável/exibível.
UPDATE `streaming_providers`
SET
  `normalized_name` = COALESCE(`normalized_name`, `name`),
  `root_key` = COALESCE(`root_key`, `provider_slug`, LOWER(REPLACE(`name`, ' ', '-'))),
  `root_name` = COALESCE(`root_name`, `name`),
  `family_key` = COALESCE(`family_key`, `provider_slug`, LOWER(REPLACE(`name`, ' ', '-'))),
  `family_name` = COALESCE(`family_name`, `name`),
  `variant_key` = COALESCE(`variant_key`, 'direct'),
  `access_kind` = COALESCE(`access_kind`, 'included');

-- Catálogo mínimo de escolhas do Perfil. IDs estáveis desacoplam a preferência
-- do usuário dos IDs de uma fonte externa; tmdb_provider_id fica opcional.
INSERT IGNORE INTO `streaming_providers`
  (`id`, `name`, `logo_path`, `provider_slug`, `normalized_name`, `root_key`, `root_name`, `family_key`, `family_name`, `variant_key`, `variant_name`, `access_kind`, `default_priority`, `country`, `is_active`, `created_at`, `updated_at`)
VALUES
  ('provider-netflix-direct-br', 'Netflix', NULL, 'netflix-direct', 'Netflix', 'netflix', 'Netflix', 'netflix', 'Netflix', 'direct', NULL, 'included', 10, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-netflix-ads-br', 'Netflix Standard with Ads', NULL, 'netflix-ads', 'Netflix com anúncios', 'netflix', 'Netflix', 'netflix', 'Netflix', 'ads', 'Com anúncios', 'ads', 10, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-max-direct-br', 'HBO MAX', 'https://images.justwatch.com/icon/332884837/s100/max.png', 'max-direct', 'HBO MAX', 'max', 'HBO MAX', 'max', 'HBO MAX', 'direct', NULL, 'included', 40, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-hbo-max-legacy-br', 'HBO Max', 'https://images.justwatch.com/icon/332884837/s100/max.png', 'hbo-max-legacy', 'HBO MAX', 'max', 'HBO MAX', 'max', 'HBO MAX', 'direct', NULL, 'included', 40, 'BR', false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-max-prime-channel-br', 'HBO Max Amazon Channel', 'https://images.justwatch.com/icon/343788557/s100/amazonhbomax.png', 'max-prime-channel', 'HBO MAX via Prime Video', 'max', 'HBO MAX', 'max', 'HBO MAX', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 40, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-max-apple-channel-br', 'HBO Max Apple TV Channel', 'https://images.justwatch.com/icon/332884837/s100/max.png', 'max-apple-channel', 'HBO MAX via Apple TV', 'max', 'HBO MAX', 'max', 'HBO MAX', 'apple-tv-channel', 'Via Apple TV', 'partner_channel', 40, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-prime-direct-br', 'Amazon Prime Video', NULL, 'prime-video-direct', 'Prime Video', 'prime-video', 'Prime Video', 'prime-video', 'Prime Video', 'direct', NULL, 'included', 20, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-prime-ads-br', 'Amazon Prime Video with Ads', NULL, 'prime-video-ads', 'Prime Video com anúncios', 'prime-video', 'Prime Video', 'prime-video', 'Prime Video', 'ads', 'Com anúncios', 'ads', 20, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-prime-store-br', 'Amazon Video', NULL, 'prime-video-store', 'Prime Video aluguel/compra', 'prime-video', 'Prime Video', 'prime-video', 'Prime Video', 'rent-buy', 'Aluguel/compra', 'rent_buy', 20, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-disney-direct-br', 'Disney Plus', NULL, 'disney-plus-direct', 'Disney+', 'disney-plus', 'Disney+', 'disney-plus', 'Disney+', 'direct', NULL, 'included', 30, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-apple-direct-br', 'Apple TV Plus', 'https://images.justwatch.com/icon/338367329/s100/appletvplus.jpeg', 'apple-tv-plus-direct', 'Apple TV+', 'apple-tv-plus', 'Apple TV+', 'apple-tv-plus', 'Apple TV+', 'direct', NULL, 'included', 50, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-apple-prime-channel-br', 'Apple TV Amazon Channel', 'https://images.justwatch.com/icon/338254390/s100/amazonappletvplus.png', 'apple-tv-plus-prime-channel', 'Apple TV+ via Prime Video', 'apple-tv-plus', 'Apple TV+', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 50, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-apple-store-br', 'Apple TV Store', 'https://images.justwatch.com/icon/338253243/s100/itunes.png', 'apple-tv-store', 'Apple TV aluguel/compra', 'apple-tv-store', 'Apple TV', 'apple-tv-store', 'Apple TV', 'rent-buy', 'Aluguel/compra', 'rent_buy', 55, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-globoplay-direct-br', 'Globoplay', NULL, 'globoplay-direct', 'Globoplay', 'globoplay', 'Globoplay', 'globoplay', 'Globoplay', 'direct', NULL, 'included', 60, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-globoplay-prime-channel-br', 'Globoplay Amazon Channel', NULL, 'globoplay-prime-channel', 'Globoplay via Prime Video', 'globoplay', 'Globoplay', 'globoplay', 'Globoplay', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 60, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-paramount-direct-br', 'Paramount Plus', NULL, 'paramount-plus-direct', 'Paramount+', 'paramount-plus', 'Paramount+', 'paramount-plus', 'Paramount+', 'direct', NULL, 'included', 70, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-paramount-prime-channel-br', 'Paramount+ Amazon Channel', 'https://images.justwatch.com/icon/246478651/s100/amazonparamountplus.png', 'paramount-plus-prime-channel', 'Paramount+ via Prime Video', 'paramount-plus', 'Paramount+', 'paramount-plus', 'Paramount+', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 70, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-paramount-apple-channel-br', 'Paramount Plus Apple TV Channel', 'https://images.justwatch.com/icon/303391391/s100/appletvparamountplus.png', 'paramount-plus-apple-channel', 'Paramount+ via Apple TV', 'paramount-plus', 'Paramount+', 'paramount-plus', 'Paramount+', 'apple-tv-channel', 'Via Apple TV', 'partner_channel', 70, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-crunchyroll-direct-br', 'Crunchyroll', NULL, 'crunchyroll-direct', 'Crunchyroll', 'crunchyroll', 'Crunchyroll', 'crunchyroll', 'Crunchyroll', 'direct', NULL, 'included', 80, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-mubi-direct-br', 'MUBI', NULL, 'mubi-direct', 'MUBI', 'mubi', 'MUBI', 'mubi', 'MUBI', 'direct', NULL, 'included', 90, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-mubi-prime-channel-br', 'MUBI Amazon Channel', 'https://images.justwatch.com/icon/241732473/s100/amazonmubi.png', 'mubi-prime-channel', 'MUBI via Prime Video', 'mubi', 'MUBI', 'mubi', 'MUBI', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 90, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-telecine-direct-br', 'Telecine Play', NULL, 'telecine-direct', 'Telecine', 'telecine', 'Telecine', 'telecine', 'Telecine', 'direct', NULL, 'included', 100, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-pluto-free-br', 'Pluto TV', NULL, 'pluto-tv-free', 'Pluto TV grátis', 'pluto-tv', 'Pluto TV', 'pluto-tv', 'Pluto TV', 'free', 'Grátis', 'free', 110, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-mercado-free-br', 'Mercado Play', NULL, 'mercado-play-free', 'Mercado Play grátis', 'mercado-play', 'Mercado Play', 'mercado-play', 'Mercado Play', 'free', 'Grátis', 'free', 120, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-plex-free-br', 'Plex', NULL, 'plex-free', 'Plex grátis', 'plex', 'Plex', 'plex', 'Plex', 'free', 'Grátis', 'free', 130, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-netmovies-free-br', 'NetMovies', NULL, 'netmovies-free', 'NetMovies grátis', 'netmovies', 'NetMovies', 'netmovies', 'NetMovies', 'free', 'Grátis', 'free', 140, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-claro-direct-br', 'Claro Video', NULL, 'claro-video-direct', 'Claro Video', 'claro-video', 'Claro Video', 'claro-video', 'Claro Video', 'direct', NULL, 'included', 150, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-youtube-direct-br', 'YouTube Premium', NULL, 'youtube-direct', 'YouTube', 'youtube', 'YouTube', 'youtube', 'YouTube', 'direct', NULL, 'included', 170, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-google-store-br', 'Google Play Movies', NULL, 'google-play-store', 'Google Play aluguel/compra', 'google-play', 'Google Play', 'google-play', 'Google Play', 'rent-buy', 'Aluguel/compra', 'rent_buy', 180, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `streaming_providers`
  (`id`, `name`, `logo_path`, `provider_slug`, `normalized_name`, `root_key`, `root_name`, `family_key`, `family_name`, `variant_key`, `variant_name`, `access_kind`, `default_priority`, `country`, `is_active`, `created_at`, `updated_at`)
VALUES
  ('provider-telecine-prime-channel-br', 'Telecine Amazon Channel', 'https://images.justwatch.com/icon/318069566/s100/amazontelecine.png', 'telecine-prime-channel', 'Telecine via Prime Video', 'telecine', 'Telecine', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 100, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-mgm-prime-channel-br', 'MGM+ Amazon Channel', 'https://images.justwatch.com/icon/302467404/s100/amazonmgmplus.png', 'mgm-plus-prime-channel', 'MGM+ via Prime Video', 'mgm-plus', 'MGM+', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 190, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-mgm-apple-channel-br', 'MGM+ Apple TV Channel', 'https://images.justwatch.com/icon/313376726/s100/appletvmgmplus.png', 'mgm-plus-apple-channel', 'MGM+ via Apple TV', 'mgm-plus', 'MGM+', 'apple-tv-plus', 'Apple TV+', 'apple-tv-channel', 'Via Apple TV', 'partner_channel', 190, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-universal-prime-channel-br', 'Universal+ Amazon Channel', 'https://images.justwatch.com/icon/304872009/s100/amazonuniversalplus.png', 'universal-plus-prime-channel', 'Universal+ via Prime Video', 'universal-plus', 'Universal+', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 200, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-diamond-prime-channel-br', 'Diamond Films Amazon Channel', 'https://images.justwatch.com/icon/339010714/s100/amazondiamondfilms.png', 'diamond-films-prime-channel', 'Diamond Films via Prime Video', 'diamond-films', 'Diamond Films', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 220, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-reserva-prime-channel-br', 'Reserva Imovision Amazon Channel', NULL, 'reserva-imovision-prime-channel', 'Reserva Imovision via Prime Video', 'reserva-imovision', 'Reserva Imovision', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 230, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-looke-prime-channel-br', 'Looke Amazon Channel', 'https://images.justwatch.com/icon/259251955/s100/amazonlooke.png', 'looke-prime-channel', 'Looke via Prime Video', 'looke', 'Looke', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 240, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-belas-artes-prime-channel-br', 'Belas Artes à La Carte Amazon Channel', NULL, 'belas-artes-prime-channel', 'Belas Artes à La Carte via Prime Video', 'belas-artes', 'Belas Artes à La Carte', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 250, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-filmbox-prime-channel-br', 'Filmbox Amazon Channel', NULL, 'filmbox-prime-channel', 'Filmbox via Prime Video', 'filmbox', 'Filmbox', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 260, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-lionsgate-prime-channel-br', 'Lionsgate+ Amazon Channel', NULL, 'lionsgate-plus-prime-channel', 'Lionsgate+ via Prime Video', 'lionsgate-plus', 'Lionsgate+', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 270, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-filmelier-prime-channel-br', 'Filmelier+ Amazon Channel', NULL, 'filmelier-plus-prime-channel', 'Filmelier+ via Prime Video', 'filmelier-plus', 'Filmelier+', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 280, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-o2play-prime-channel-br', 'O2Play Amazon Channel', NULL, 'o2play-prime-channel', 'O2Play via Prime Video', 'o2play', 'O2Play', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 290, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('provider-curta-on-prime-channel-br', 'Curta!On Amazon Channel', NULL, 'curta-on-prime-channel', 'Curta!On via Prime Video', 'curta-on', 'Curta!On', 'prime-video', 'Prime Video', 'prime-video-channel', 'Via Prime Video', 'partner_channel', 300, 'BR', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

UPDATE `streaming_providers`
SET `family_key` = 'prime-video', `family_name` = 'Prime Video'
WHERE `country` = 'BR' AND `variant_key` = 'prime-video-channel';

UPDATE `streaming_providers`
SET `family_key` = 'apple-tv-plus', `family_name` = 'Apple TV+'
WHERE `country` = 'BR' AND `variant_key` = 'apple-tv-channel';

-- `best_provider_name` é um campo materializado de UI (não é evidência bruta), então
-- pode receber o nome canônico para remover fragmentação dos cards históricos.
UPDATE `user_title_state`
SET `best_provider_name` = 'HBO MAX'
WHERE LOWER(`best_provider_name`) IN ('hbo max', 'hbomax', 'max', 'max.com');

UPDATE `user_title_state`
SET `best_provider_name` = 'Prime Video'
WHERE LOWER(`best_provider_name`) = 'amazon prime video';
