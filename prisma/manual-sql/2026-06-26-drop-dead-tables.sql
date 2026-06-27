-- POPLOG — Drop de tabelas mortas (D4/D5). Branch feature/sistema-novo, 2026-06-26.
-- Contexto: pré-deploy; regression:local confirmou would_delete=0 nas três.
-- Models removidos de prisma/schema.prisma: UserWatching, Poplog3TitleAvailability,
-- Poplog3AvailabilityFallbackState. Detalhe: POPLOG_GLOBAL_UNIFICATION_PLAN.md §13.
--
-- Caminho recomendado (gera a migration oficial + regenera o client):
--   npx prisma migrate dev --name drop_dead_tables
-- Alternativa local rápida: npm run db:push   (sincroniza o schema, dropa as tabelas)
-- Este SQL é referência/fallback manual equivalente:

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `poplog3_title_availability`;
DROP TABLE IF EXISTS `poplog3_availability_fallback_state`;
DROP TABLE IF EXISTS `user_watching`;
SET FOREIGN_KEY_CHECKS = 1;
