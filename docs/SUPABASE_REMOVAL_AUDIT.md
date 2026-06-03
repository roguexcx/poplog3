# Supabase Removal Audit

Status: Fase 13C.2. Auth.js/NextAuth + Prisma segue como caminho real de auth. As ultimas rotas/engines do escopo 13C.2 foram migradas para Prisma/local services. Supabase permanece instalado e funcional apenas como fallback/legado ate a 13D.

## Resumo

| Grupo | Status | Acao |
| --- | --- | --- |
| Auth | Parcialmente migrado | Auth.js ativo; Supabase Auth fallback temporario |
| Rotas de usuario | Parcial | `feedback`, `not-interested`, `streaming-preferences`, `watchlist/live` e `watchlist-hydrate` usam Prisma/local no caminho principal; fallbacks legados ficam para 13D |
| Rotas publicas | Parcial | `discover`, `search`, `trending` autenticam via `getCurrentUser()` |
| Admin/debug/backfill | Parcial | Backfill/hydrate/radar debug uteis migrados; diagnosticos Supabase e scripts antigos ficam para 13D |
| Engines/background jobs | Parcial | `sorteio`, `agenda-engine`, fuzzy search, batch refresh e `rating_aggregates` migrados; caches/continuity legados ficam para 13D |
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

## Migrado na 13C.2

| Arquivo | Tipo | Status | Risco |
| --- | --- | --- | --- |
| `src/app/api/watchlist/live/route.ts` | rota usuario | Removeu leituras Supabase de `poplog3_titles`/availability; usa `poplog3_titles`, `catalog_availability`, `user_title_state` e helpers locais | Medio |
| `src/app/api/library/watchlist-hydrate/route.ts` | rota usuario/job | Hidrata watchlist via Prisma para `user_title_state`, `poplog3_titles` e `poplog3_episodes`; sync TMDB preservado | Medio |
| `src/server/sorteio/sorteio-engine.ts` | engine | Biblioteca, feedback, availability e eventos migrados para Prisma/local DB | Medio |
| `src/server/agenda/agenda-engine.ts` | engine | Biblioteca, titulos e availability migrados para Prisma/local DB; chamadas externas preservadas | Medio |
| `src/server/search/fuzzy-title-search.ts` | engine helper | Busca fuzzy em `poplog3_titles` via Prisma | Baixo |
| `src/server/streaming/batch-availability-refresh.ts` | background job | Refresh em lote usa preferencias locais, availability local e `user_title_state` via Prisma | Medio |
| `src/server/ratings/rating-aggregate-service.ts` | service | `rating_aggregates` reimplementado com Prisma | Medio |
| `src/server/ratings/user-rating-service.ts` | service | Caminho local recalcula agregados apos upsert/delete para evitar inconsistencia | Medio |
| `src/app/api/admin/backfill-title-state/route.ts` | admin/backfill | Leitura de biblioteca e estados via Prisma | Baixo |
| `src/app/api/admin/hydrate-library/route.ts` | admin/hydrate | Leitura de biblioteca/titulos via Prisma | Baixo |
| `src/app/api/admin/hydrate-series-episodes/route.ts` | admin/hydrate | Leitura de episodios locais/catalogo e contagens via Prisma | Baixo |
| `src/app/api/admin/radar-cache-flush/route.ts` | admin/debug | Cache ICS via Prisma | Baixo |
| `src/app/api/admin/radar-personal-debug/route.ts` | admin/debug | Cache e estado pessoal via Prisma | Baixo |
| `scripts/smoke-test-rating-aggregates.ts` | smoke | Valida agregados de filme e inferencia serie a partir de episodios | Baixo |

## Ainda depende de Supabase Auth

| Arquivo | Motivo | Fase |
| --- | --- | --- |
| `src/server/auth/get-current-user.ts` | Fallback Supabase Auth apos local/Auth.js | 13D |
| `src/proxy.ts` | Fallback Supabase SSR quando Auth.js/local nao resolvem | 13D |
| `src/lib/personalization/feedback.ts` | Cria client Supabase quando feedback local esta OFF | 13D |
| `src/components/auth/LoginDrawer.tsx` | Formulario Supabase fallback | 13D |
| `src/components/layout/Sidebar.tsx` | Sign-out Supabase fallback | 13D |
| `src/app/profile/ProfilePageClient.tsx` | Sign-out Supabase fallback | 13D |

## Ainda depende de Supabase dados/admin

| Grupo | Exemplos | Fase |
| --- | --- | --- |
| Admin/debug legado | `debug/supabase`, `debug/local-db/acompanhando-diff`, diagnosticos de continuidade | 13D |
| Scripts antigos | `backfill-movie-duration`, `backfill-user-title-state`, `smoke-test-feedback-engine` | 13D |
| Continuidade fallback | `continue`, `recently-watched`, `new-episodes`, `watchlist-picks`, `upcoming-episodes`, `acompanhando` fallback | 13D apos paridade |
| Cache/repositorios fallback | `title-cache`, `season-cache`, `availability-cache`, `ratings-cache`, `external-ids-cache`, `library-service`, `episode-progress-service`, `engine-logger` | 13D |
| Radar legado | `src/app/radar/page.tsx`, fallback Supabase em `src/app/api/radar/route.ts` | 13D |
| User routes fallback | `for-you`, `genre-stats`, `feedback`, `streaming-preferences`, `not-interested`, `trending` quando flags locais estao OFF | 13D |
| Wrappers | `src/server/supabase/*`, `src/lib/supabase/*` | 13D |
| Pacotes/envs | `@supabase/supabase-js`, `@supabase/ssr`, envs Supabase | 13D |
| Supabase legado | `supabase/migrations/*`, `supabase/functions/*` | 13D |

## Decisoes admin/debug/backfill 13C.2

| Item | Decisao | Justificativa |
| --- | --- | --- |
| `admin/backfill-title-state` | Migrado para Prisma | Ainda util para reconciliar `user_titles` e `user_title_state` no MySQL |
| `hydrate-library` | Migrado para Prisma | Ainda util para preencher metadados locais |
| `hydrate-series-episodes` | Migrado para Prisma | Ainda util para catalogo local de episodios |
| `watchlist-hydrate` | Migrado para Prisma | Faz parte do fluxo real de biblioteca/watchlist |
| `radar-cache-flush` | Migrado para Prisma | Operacao simples sobre cache local |
| `radar-personal-debug` | Migrado para Prisma | Diagnostico util do estado local |
| `debug/supabase` | Manter temporario | Diagnostico legado ate remover dependencias/envs na 13D |
| `debug/local-db/acompanhando-diff` | Manter temporario | Comparador Supabase vs MySQL ate paridade final |
| Scripts Supabase antigos | Manter temporario | Nao foram removidos por regra; devem ser migrados ou apagados na 13D |

## Observacoes 13C.2

- Nenhum modelo Prisma novo foi necessario nesta fase; nao houve migration incremental.
- `rating_aggregates` agora e mantido via Prisma e recalculado no caminho local de notas pessoais.
- Availability local em `sorteio` usa `catalog_availability`. Essa tabela ainda nao expoe `tmdb_provider_id`, entao o bonus de provedor preferido so fica 100% equivalente quando houver mapeamento de provider local suficiente.
- Supabase segue instalado por regra e por fallbacks legados. A remocao final deve ser feita apenas depois de validar que as flags locais permanecem ativas em producao.

## Prisma migrations

`00000000000000_init` continua como baseline. `00000000000001_authjs` adiciona Auth.js. `00000000000002_streaming_preferences` adiciona as preferencias de streaming locais. Como o banco local historico foi mantido por `db push`, validar ambiente real com:

1. banco vazio: `prisma migrate deploy`;
2. banco existente equivalente: diff limpo antes de `migrate resolve`;
3. local atual: `npm run db:push`.

## Proximas fases

| Fase | Objetivo |
| --- | --- |
| 13D | Remover Supabase Auth/deps/wrappers/envs/functions/migrations legadas; apagar/desativar scripts e diagnosticos Supabase |
