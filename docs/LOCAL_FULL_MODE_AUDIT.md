# Auditoria de Dependências Supabase — Local Full Mode

> Gerado em 2026-06-03 (Fase 9). Atualizado na Fase 13D para refletir a remocao completa do Supabase.
> Este documento registra o historico da migracao. O modo local completo e agora o modo normal de desenvolvimento — nao requer Supabase.

## Legenda

| Coluna | Descricao |
|---|---|
| Arquivo | Path relativo a `src/` |
| Tipo | auth · data · admin · client-ui · debug |
| Status | Migrada · Removida · n/a |

---

## Resultado da migracao (Fase 13D+)

Supabase foi completamente removido do stack em 2026-06-03. Todas as dependencias abaixo foram migradas para MySQL/Prisma ou Auth.js. O historico de cada arquivo esta documentado nas secoes seguintes para referencia.

---

## A — Auth

| Arquivo | Tipo | Status |
|---|---|---|
| `proxy.ts` | auth | Migrada — usa Auth.js + bypass local |
| `server/auth/get-current-user.ts` | auth | Migrada (Fase 13B) — usa Auth.js/Prisma |
| `server/supabase/server.ts` | auth | Removida (Fase 13D) |
| `server/supabase/admin.ts` | admin-client | Removida (Fase 13D) |

---

## B — Dados migrados para MySQL/Prisma

Todos estes arquivos foram migrados. O caminho Supabase foi removido.

| Arquivo | Tabelas MySQL equivalentes | Status |
|---|---|---|
| `server/continuity/continuity-section-cache.ts` | `continuity_section_cache` | Migrada |
| `server/cache/title-cache.ts` | `poplog3_titles` | Migrada |
| `server/cache/season-cache.ts` | `poplog3_seasons`, `poplog3_episodes` | Migrada |
| `server/cache/ratings-cache.ts` | `title_ratings` | Migrada |
| `server/cache/external-ids-cache.ts` | `external_ids_cache` | Migrada |
| `lib/personalization/feedback.ts` | `user_title_feedback` | Migrada |
| `app/api/user/feedback/route.ts` | `user_title_feedback`, `user_title_state`, `user_titles` | Migrada |
| `app/api/user/not-interested/route.ts` | `user_title_feedback`, `user_titles`, `poplog3_titles` | Migrada |
| `app/api/user/feedback/batch/route.ts` | `user_title_feedback` | Migrada |
| `server/library/library-service.ts` | `user_titles` | Migrada |
| `app/api/library/route.ts` | `user_titles` | Migrada |
| `app/api/library/title/route.ts` | `user_titles` | Migrada |
| `server/state/user-title-state.ts` | `user_title_state` | Migrada |
| `server/episodes/episode-progress-service.ts` | `user_episodes`, `user_title_state`, `user_titles` | Migrada |
| `server/ratings/user-rating-service.ts` | `user_ratings` | Migrada |
| `server/streaming/user-provider-preferences.ts` | `user_streaming_preferences`, `streaming_providers` | Migrada |
| `app/api/user/streaming-preferences/route.ts` | `user_streaming_preferences`, `streaming_providers` | Migrada |
| `server/runtime/series-episode-runtimes.ts` | `poplog3_episodes` | Migrada |
| `server/streaming/availability-fallback-state.ts` | `poplog3_availability_fallback_state` | Migrada |
| `app/api/watchlist/live/route.ts` | `poplog3_titles`, `catalog_availability`, `user_title_state` | Migrada 13C.2 |
| `app/api/library/watchlist-hydrate/route.ts` | `user_title_state`, `poplog3_titles`, `poplog3_episodes` | Migrada 13C.2 |
| `server/agenda/agenda-engine.ts` | `user_titles`, `poplog3_titles`, `catalog_availability` | Migrada 13C.2 |
| `server/sorteio/sorteio-engine.ts` | `user_title_state`, `user_title_feedback`, `poplog3_titles`, `catalog_availability`, `user_events` | Migrada 13C.2 |
| `server/search/fuzzy-title-search.ts` | `poplog3_titles` | Migrada 13C.2 |
| `server/streaming/batch-availability-refresh.ts` | `user_title_state`, availability local | Migrada 13C.2 |
| `server/ratings/rating-aggregate-service.ts` | `rating_aggregates`, `user_ratings` | Migrada 13C.2 |
| `app/api/poplog3/acompanhando/route.ts` | `user_titles`, `user_curadoria_state`, `user_watching` | Migrada 13D |
| `app/api/poplog3/continuity/hero/route.ts` | `hero_impressions`, `user_title_state`, `user_titles` | Migrada |
| `server/continuity/hero-candidates.ts` | `poplog3_title_availability`, `user_title_state`, `user_titles`, `poplog3_titles` | Migrada |
| `server/continuity/hero-impressions.ts` | `hero_impressions` | Migrada |
| `app/api/poplog3/continuity/continue/route.ts` | `user_title_state` via cache | Migrada |
| `app/api/poplog3/continuity/recently-watched/route.ts` | `user_title_state` via cache | Migrada |
| `app/api/poplog3/continuity/new-episodes/route.ts` | `user_title_state` via cache | Migrada |
| `app/api/poplog3/continuity/watchlist-picks/route.ts` | `user_title_state` via cache | Migrada |
| `app/api/radar/route.ts` | `user_title_state` (modo personal) | Migrada |
| `app/api/poplog3/agenda/route.ts` | `user_titles`, `user_title_state`, `poplog3_title_availability` | Migrada |
| `app/api/user/genre-stats/route.ts` | `user_titles` | Migrada 13D |
| `app/api/user/for-you/route.ts` | `user_title_feedback`, queries diversas | Migrada 13D |
| `app/api/trending/route.ts` | `poplog3_titles` + joins | Migrada 13D |
| `app/api/poplog3/continuity/upcoming-episodes/route.ts` | `user_title_state`, `poplog3_episodes` | Migrada 13D |
| `app/api/poplog3/agenda/v2/route.ts` | idem agenda-engine | Migrada 13D |
| `server/continuity/continuity-state-cache.ts` | `user_title_state` | Migrada |

---

## C — UI / Client-side

Estes arquivos foram migrados para Auth.js na Fase 13B/13D.

| Arquivo | Status |
|---|---|
| `hooks/useAuth.ts` | Migrada — usa `/api/auth/current` (Auth.js) |
| `components/auth/LoginDrawer.tsx` | Migrada — usa Auth.js sign-in |
| `components/layout/Sidebar.tsx` | Migrada — usa Auth.js sign-out |
| `app/profile/ProfilePageClient.tsx` | Migrada — usa session Auth.js |
| `features/home/HomeMemberSections.tsx` | Migrada — usa session Auth.js |
| `context/UserDataContext.tsx` | Migrada — queries via API routes Prisma |
| `features/home/components/WatchlistVivaSection.tsx` | Migrada — via API routes Prisma |
| `lib/user-title-service.ts` | Migrada — via API routes Prisma |
| `lib/episodes/episode-validators.ts` | Migrada — via API routes Prisma |
| `lib/supabase/client.ts` | Removida (Fase 13D) |
| `lib/supabase/server.ts` | Removida (Fase 13D) |

---

## D — Debug / Admin

| Arquivo | Uso | Status |
|---|---|---|
| `app/api/debug/config/route.ts` | Exibe configuracao de env | Atualizado — nao referencia mais envs Supabase |
| `app/api/debug/supabase/route.ts` | Testava conexao Supabase | Removido ou desativado (Fase 13D) |
| `app/api/debug/local-db/acompanhando-diff/route.ts` | Diff local vs Supabase | Removido (Fase 13D) |
| `app/api/admin/backfill-title-state/route.ts` | Backfill admin | Migrado para Prisma na 13C.2 |
| `app/api/admin/hydrate-library/route.ts` | Hydrate admin | Migrado para Prisma na 13C.2 |
| `app/api/admin/hydrate-series-episodes/route.ts` | Hydrate admin | Migrado para Prisma na 13C.2 |
| `app/api/admin/radar-personal-debug/route.ts` | Debug radar | Migrado para Prisma na 13C.2 |
| `app/api/admin/radar-cache-flush/route.ts` | Flush cache radar | Migrado para Prisma na 13C.2 |

---

## Variaveis de ambiente Supabase (removidas)

As seguintes variaveis foram removidas do stack e nao devem aparecer em nenhum `.env` de producao ou desenvolvimento:

| Variavel | Motivo da remocao |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase removido na Fase 13D |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase removido na Fase 13D |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase removido na Fase 13D |

Em desenvolvimento local, nenhuma dessas variaveis e necessaria. O modo local usa:
- `POPLOG_LOCAL_AUTH_ENABLED=true` + `LOCAL_USER_ID=local-user` para auth
- `DATABASE_URL` apontando para MySQL Docker local

---

## Correcoes aplicadas por fase

| Fase | Arquivo | Acao |
|---|---|---|
| Fase 9 | `server/supabase/admin.ts` | Removido throw em init; usa placeholder URLs |
| Fase 9 | `src/middleware.ts` | Criado middleware Next.js com bypass por `POPLOG_LOCAL_AUTH_ENABLED` |
| Fase 13B | `server/auth/get-current-user.ts` | Migrado para Auth.js/Prisma |
| Fase 13C.2 | Multiplos engines/rotas | Migrados para Prisma (agenda, sorteio, search, etc.) |
| Fase 13D | `server/supabase/*`, `lib/supabase/*` | Removidos do codebase |
| Fase 13D | UI components | Migrados para Auth.js |
| Fase 13E | `package.json` | Removidos `@supabase/supabase-js`, `@supabase/ssr` |
