# Supabase Removal Audit

Status: Fase 13C. Auth.js/NextAuth + Prisma segue como caminho real de auth. Rotas simples de feedback, streaming preferences e alguns helpers de engine agora usam Prisma/local por flag. Supabase permanece instalado e funcional como fallback/legado.

## Resumo

| Grupo | Status | Acao |
| --- | --- | --- |
| Auth | Parcialmente migrado | Auth.js ativo; Supabase Auth fallback temporario |
| Rotas de usuario | Parcial | `for-you`, `feedback`, `not-interested`, `streaming-preferences` e auth de `watchlist/live` migrados; dados de `watchlist/live` ficam para 13C.2 |
| Rotas publicas | Parcial | `discover`, `search`, `trending` autenticam via `getCurrentUser()` |
| Admin/debug/backfill | Manter temporario | Migrar/remover em 13C/13D |
| Engines/background jobs | Parcial | Runtime de episodios e fallback-state migrados; `sorteio`, `agenda-engine`, fuzzy search, batch refresh e `rating_aggregates` ficam para 13C.2 |
| Fallback removivel | 13D | Remover deps, wrappers, envs e functions/migrations Supabase legadas |

## Migrado na 13A

| Arquivo | Status |
| --- | --- |
| `src/app/api/poplog3/continuity/upcoming-episodes/route.ts` | Caminho Prisma local com fallback Supabase |
| `src/app/api/user/genre-stats/route.ts` | Caminho Prisma local com fallback Supabase |
| `prisma/migrations/00000000000000_init/migration.sql` | Baseline Prisma inicial |

## Migrado na 13B

| Arquivo | Tipo | Status | Risco |
| --- | --- | --- | --- |
| `package.json`, `package-lock.json` | deps Auth.js | `next-auth@beta`, `@auth/prisma-adapter` adicionados | Medio |
| `prisma/schema.prisma` | modelos Auth.js | `Account`, `Session`, `VerificationToken`, `User.image` | Medio |
| `prisma/migrations/00000000000001_authjs/migration.sql` | migration | Auth.js incremental | Medio |
| `src/server/auth/auth-options.ts` | config | Google OAuth + Prisma adapter | Baixo |
| `src/server/auth/next-auth.ts` | helper | `handlers`, `auth`, `signIn`, `signOut` | Baixo |
| `src/app/api/auth/[...nextauth]/route.ts` | route | Auth.js App Router | Baixo |
| `src/app/api/auth/current/route.ts` | route | Sessao client por `getCurrentUser()` | Baixo |
| `src/server/auth/get-current-user.ts` | auth server | local -> Auth.js -> Supabase fallback | Medio |
| `src/proxy.ts` | proxy | local bypass, Auth.js, fallback Supabase | Medio |
| `src/hooks/useAuth.ts` | client auth | Remove Supabase direto do hook | Baixo |
| `src/components/auth/LoginDrawer.tsx` | UI auth | Google OAuth primario; Supabase form fallback | Medio |
| `src/components/layout/Sidebar.tsx` | UI auth | Usa `useAuth`; Auth.js signOut; fallback Supabase signOut | Medio |
| `src/app/profile/ProfilePageClient.tsx` | UI auth | Usa `useAuth`; stats via `/api/library`; fallback Supabase signOut | Medio |
| `src/features/home/HomePage.tsx` | server auth | Usa `getCurrentUser()` | Baixo |
| `src/features/home/HomeMemberSections.tsx` | types | Usa `AuthUser` | Baixo |
| `src/context/UserDataContext.tsx` | client data | Usa `/api/library` em vez de Supabase client | Medio |
| `src/app/api/discover/route.ts` | route auth | Usa `getCurrentUser()` | Baixo |
| `src/app/api/search/route.ts` | route auth | Usa `getCurrentUser()` | Baixo |
| `src/app/api/trending/route.ts` | route auth | Usa `getCurrentUser()`; cache/dados Supabase ainda ficam | Medio |
| `src/app/api/user/for-you/route.ts` | route auth | Usa `getCurrentUser()`; dados Supabase ainda ficam | Medio |

## Migrado na 13C

| Arquivo | Tipo | Status | Risco |
| --- | --- | --- | --- |
| `prisma/schema.prisma` | modelos dados | `UserStreamingPreference` e campos compatíveis em `StreamingProvider` | Baixo |
| `prisma/migrations/00000000000002_streaming_preferences/migration.sql` | migration | Tabela `user_streaming_preferences` e metadados de provider | Baixo |
| `src/server/local-services/streaming-preferences-local.service.ts` | local service | Lista providers, replace de preferencias e resolve TMDB provider IDs | Baixo |
| `src/app/api/user/streaming-preferences/route.ts` | route usuario | Auth via `getCurrentUser()`; Prisma quando `POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED`/full mode; Supabase fallback | Medio |
| `src/server/streaming/user-provider-preferences.ts` | engine helper | Prisma/local para providers favoritos; Supabase fallback | Baixo |
| `src/app/api/user/feedback/route.ts` | route usuario | Auth via `getCurrentUser()`; Supabase só no fallback de dados quando feedback local OFF | Baixo |
| `src/app/api/user/feedback/batch/route.ts` | route usuario | Auth via `getCurrentUser()`; feedback local/fallback pelo helper existente | Baixo |
| `src/app/api/user/not-interested/route.ts` | route usuario | Auth via `getCurrentUser()`; fallback Supabase admin apenas com feedback local OFF | Baixo |
| `src/app/api/watchlist/live/route.ts` | route usuario | Auth via `getCurrentUser()`; leituras de catálogo Supabase ainda pendentes | Medio |
| `src/server/runtime/series-episode-runtimes.ts` | engine helper | Lê `poplog3_episodes` via Prisma quando cache/local DB ON | Baixo |
| `src/server/streaming/availability-fallback-state.ts` | engine helper | Lê/grava `poplog3_availability_fallback_state` via Prisma quando availability local ON | Baixo |
| `scripts/db/export-local-data.ts`, `scripts/db/import-local-data.ts` | backup/export | Inclui `streaming_providers` e `user_streaming_preferences` | Baixo |
| `scripts/smoke-test-streaming-preferences.ts` | smoke | Cobre service local de preferencias de streaming | Baixo |

## Ainda depende de Supabase Auth

| Arquivo | Motivo | Fase |
| --- | --- | --- |
| `src/lib/personalization/feedback.ts` | Cria client Supabase quando feedback local esta OFF | 13D |
| `src/components/auth/LoginDrawer.tsx` | Formulario Supabase fallback | 13D |
| `src/components/layout/Sidebar.tsx` | Sign-out Supabase fallback | 13D |
| `src/app/profile/ProfilePageClient.tsx` | Sign-out Supabase fallback | 13D |

## Ainda depende de Supabase dados/admin

| Grupo | Exemplos | Fase |
| --- | --- | --- |
| Admin/debug/backfill/hydrate | `admin/backfill-title-state`, `hydrate-library`, `hydrate-series-episodes`, `watchlist-hydrate`, `debug/supabase` | 13C/13D |
| Continuidade fallback | `continue`, `recently-watched`, `new-episodes`, `watchlist-picks`, `acompanhando` fallback | 13D apos paridade |
| Watchlist live dados | `src/app/api/watchlist/live/route.ts` ainda usa `supabaseAdmin` para `poplog3_titles` e availability | 13C.2 |
| Engines | `sorteio-engine`, `agenda-engine`, `rating-aggregate-service`, `fuzzy-title-search`, `batch-availability-refresh` | 13C.2 |
| Wrappers | `src/server/supabase/*`, `src/lib/supabase/*` | 13D |
| Pacotes/envs | `@supabase/supabase-js`, `@supabase/ssr`, envs Supabase | 13D |
| Supabase legado | `supabase/migrations/*`, `supabase/functions/*` | 13D |

## Prisma migrations

`00000000000000_init` continua como baseline. `00000000000001_authjs` adiciona Auth.js. `00000000000002_streaming_preferences` adiciona as preferencias de streaming locais. Como o banco local historico foi mantido por `db push`, validar ambiente real com:

1. banco vazio: `prisma migrate deploy`;
2. banco existente equivalente: diff limpo antes de `migrate resolve`;
3. local atual: `npm run db:push`.

## Proximas fases

| Fase | Objetivo |
| --- | --- |
| 13C.2 | Migrar ultimas rotas/engines: watchlist live dados, sorteio, agenda, fuzzy search, batch refresh, rating aggregates |
| 13D | Remover Supabase Auth/deps/wrappers/envs/functions/migrations legadas |
