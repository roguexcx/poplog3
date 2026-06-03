# Supabase Removal Audit

Status: Fase 13A. Supabase permanece instalado e funcional como fallback/legado. Esta auditoria prepara a remocao final, mas nao remove `@supabase/supabase-js`, `@supabase/ssr`, `src/server/supabase`, `src/lib/supabase`, `supabase/migrations` ou `supabase/functions`.

## Resumo executivo

| Grupo | Status | Acao |
| --- | --- | --- |
| Auth | Manter temporario | Migrar em 13B para Auth.js/NextAuth; ver `docs/AUTH_MIGRATION_DECISION.md` |
| Rotas de usuario | Parcial | `genre-stats` migrado por flag local; demais dependem de Auth ou tabelas ainda sem modelo local |
| Rotas publicas | Manter temporario | `trending`, `discover`, `search` usam Supabase Auth opcional para personalizacao |
| Admin/debug/backfill/hydrate | Manter temporario | Ferramentas legadas/diagnosticas ate concluir paridade local |
| Engines/background jobs | Parcial | caches/logs/ratings/agenda/sorteio ainda tem fallback ou consultas Supabase |
| Fallback removivel | Remover na fase final | wrappers `src/server/supabase`, `src/lib/supabase`, envs e pacote npm somente na 13D |

## Migrado nesta fase

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/poplog3/continuity/upcoming-episodes/route.ts` | `supabaseAdmin` fallback | Leitura de `user_title_state` e `poplog3_titles` | Rotas de usuario/continuidade | Migrar agora: caminho Prisma quando `POPLOG_LOCAL_DB_ENABLED=true`; fallback Supabase preservado | Baixo; leitura local equivalente, usa `getCachedEpisode()` existente |
| `src/app/api/user/genre-stats/route.ts` | `supabaseAdmin` fallback | Leitura de biblioteca e generos | Rotas de usuario/profile | Migrar agora: caminho Prisma quando `POPLOG_LOCAL_DB_ENABLED=true`; fallback Supabase preservado | Baixo; agregacao simples em memoria |

## Auth

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/server/auth/get-current-user.ts` | `createSupabaseServerClient` | Auth real quando local auth esta OFF | Auth | Manter temporario; migrar em 13B | Alto; decisao central de sessao |
| `src/proxy.ts` | `@supabase/ssr`, envs publicas | Middleware/redirect por sessao Supabase | Auth | Manter temporario | Alto; troca afeta navegacao protegida |
| `src/hooks/useAuth.ts` | `@supabase/supabase-js`, `src/lib/supabase/client` | Sessao client-side | Auth UI | Manter temporario | Alto; troca afeta UI global |
| `src/components/auth/LoginDrawer.tsx` | client Supabase | Login/logout UI | Auth UI | Manter temporario | Alto |
| `src/components/layout/Sidebar.tsx` | client Supabase, type `User` | Estado de usuario/logout | Auth UI | Manter temporario | Medio |
| `src/app/profile/ProfilePageClient.tsx` | client Supabase, type `User` | Perfil client-side | Auth UI | Manter temporario | Medio |
| `src/features/home/HomePage.tsx` | `createSupabaseServerClient` | Usuario server-side para Home | Auth | Manter temporario; trocar para `getCurrentUser()` em 13B/13C | Medio |
| `src/features/home/HomeMemberSections.tsx` | type `User` | Tipagem Supabase no componente | Auth UI | Remover na fase final apos troca de tipo | Baixo |

## Rotas de usuario

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/user/streaming-preferences/route.ts` | `createSupabaseServerClient` + tabelas Supabase | Auth, `streaming_providers`, `user_streaming_preferences` | Streaming preferences | Deixar para 13B/13C; schema local nao tem `user_streaming_preferences` | Alto |
| `src/server/streaming/user-provider-preferences.ts` | `createSupabaseServerClient` | Preferencias do usuario para engines | Streaming preferences | Deixar para 13B/13C | Alto |
| `src/app/api/user/for-you/route.ts` | `createSupabaseServerClient`, `supabaseAdmin` | Auth, feedback, ratings, candidatos de cache | For You | Deixar para 13B/13C | Medio/alto |
| `src/app/api/user/feedback/route.ts` | `createSupabaseServerClient` | Auth e fallback feedback Supabase | Feedback | Manter temporario; ja e flag-aware para local feedback | Medio |
| `src/app/api/user/feedback/batch/route.ts` | `createSupabaseServerClient` | Auth e fallback feedback Supabase | Feedback | Manter temporario | Medio |
| `src/app/api/user/not-interested/route.ts` | `createSupabaseServerClient`, `supabaseAdmin` dinamico | Feedback negativo e titulo cache | Feedback | Deixar para 13B/13C | Medio |
| `src/app/api/watchlist/live/route.ts` | `createSupabaseServerClient`, `supabaseAdmin`, type `User` | Watchlist live e hidratacao | Biblioteca | Deixar para 13C | Medio |
| `src/lib/user-title-service.ts` | `src/lib/supabase/client` | Escritas client-side legadas | Biblioteca UI | Remover/substituir na fase final apos confirmar hooks | Medio |
| `src/context/UserDataContext.tsx` | client Supabase | Estado client-side legado | Biblioteca UI | Remover na fase final se nao usado por fluxo novo | Medio |
| `src/features/home/components/WatchlistVivaSection.tsx` | client Supabase | Escrita direta historica | Home/biblioteca | Deixar para 13C se ainda ativo | Medio |

## Rotas publicas com personalizacao opcional

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/discover/route.ts` | `createSupabaseServerClient` | Personalizacao por feedback se houver usuario | Discover | Deixar para 13B/13C | Baixo/medio |
| `src/app/api/search/route.ts` | `createSupabaseServerClient` | Personalizacao por feedback se houver usuario | Search | Deixar para 13B/13C | Baixo/medio |
| `src/app/api/trending/route.ts` | `createSupabaseServerClient`, `supabaseAdmin` | Personalizacao e fallback cache | Trending | Deixar para 13C | Medio |
| `src/app/api/radar/route.ts` | `supabaseAdmin` | Cache Radar/ICS legado | Radar | Manter temporario; parte ja tem local radar | Medio |
| `src/app/radar/page.tsx` | `supabaseAdmin` | Leitura server-side Radar | Radar | Manter temporario | Medio |

## Continuidade e Acompanhando

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/poplog3/acompanhando/route.ts` | `supabaseAdmin` | Fallback completo e POSTs de curadoria | Acompanhando | Manter temporario; GET local ja existe por flag | Medio |
| `src/app/api/poplog3/continuity/continue/route.ts` | `supabaseAdmin` | Fallback de titulos/temporadas | Continue | Remover na 13D apos paridade local validada | Baixo |
| `src/app/api/poplog3/continuity/recently-watched/route.ts` | `supabaseAdmin` | Fallback de titulos/episodios | Recently watched | Remover na 13D apos paridade local validada | Baixo |
| `src/app/api/poplog3/continuity/new-episodes/route.ts` | `supabaseAdmin` | Fallback de titulos/temporadas | New episodes | Remover na 13D apos paridade local validada | Baixo |
| `src/app/api/poplog3/continuity/watchlist-picks/route.ts` | `supabaseAdmin` | Fallback Hero/watchlist picks | Watchlist picks | Remover na 13D apos paridade local validada | Baixo/medio |
| `src/app/api/poplog3/continuity/debug/route.ts` | `supabaseAdmin` | Debug de episodios/titulos | Debug | Remover/desativar na fase final | Baixo |
| `src/app/api/poplog3/continuity/title-debug/route.ts` | `supabaseAdmin` | Debug de titulo | Debug | Remover/desativar na fase final | Baixo |
| `src/app/api/debug/local-db/acompanhando-diff/route.ts` | `supabaseAdmin` | Comparacao local vs Supabase | Debug local | Remover na 13D | Baixo |

## Admin, debug, backfill e hydrate

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/admin/backfill-title-state/route.ts` | `supabaseAdmin` | Backfill legado | Admin/backfill | Deixar para 13C; substituir por job Prisma ou remover | Medio |
| `src/app/api/admin/hydrate-library/route.ts` | `supabaseAdmin` | Hidratacao legado | Admin/hydrate | Deixar para 13C | Medio |
| `src/app/api/admin/hydrate-series-episodes/route.ts` | `supabaseAdmin` | Hidratacao episodios | Admin/hydrate | Deixar para 13C | Medio |
| `src/app/api/admin/radar-cache-flush/route.ts` | `supabaseAdmin` | Flush cache Radar | Admin/debug | Deixar para 13C | Baixo/medio |
| `src/app/api/admin/radar-personal-debug/route.ts` | `supabaseAdmin` | Debug pessoal Radar | Admin/debug | Remover/desativar na fase final | Baixo |
| `src/app/api/debug/supabase/route.ts` | envs Supabase | Healthcheck Supabase | Debug | Remover na 13D | Baixo |
| `src/app/api/debug/config/route.ts` | envs Supabase | Exibe presenca de envs | Debug | Atualizar na 13D | Baixo |
| `src/app/api/library/watchlist-hydrate/route.ts` | `supabaseAdmin` | Hidratacao watchlist | Admin/hydrate | Deixar para 13C | Medio |
| `scripts/backfill-user-title-state.ts` | `@supabase/supabase-js`, envs | Backfill remoto legado | Scripts | Manter ate 13D; arquivar/remover depois | Medio |
| `scripts/backfill-movie-duration.ts` | import dinamico `supabaseAdmin` | Backfill remoto legado | Scripts | Deixar para 13C/13D | Medio |
| `scripts/check-feedback-engine.ts` / `scripts/smoke-test-feedback-engine.ts` | Supabase remoto | Checks legados | Scripts | Remover/adaptar na 13D | Baixo/medio |

## Engines/background jobs

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `src/server/sorteio/sorteio-engine.ts` | `supabaseAdmin` | Biblioteca, feedback, disponibilidade, eventos | Sorteio | Deixar para 13C; migracao media, varias consultas | Medio |
| `src/server/agenda/agenda-engine.ts` | `supabaseAdmin` | Biblioteca, titulos, disponibilidade | Agenda | Deixar para 13C; parte ja usa `getUserTitleStates()` local | Medio |
| `src/server/ratings/rating-aggregate-service.ts` | `supabaseAdmin` | `rating_aggregates` e RPC/consultas | Ratings | Decisao propria; migrar para Prisma service em 13C | Medio/alto |
| `src/server/cache/title-cache.ts` | `supabaseAdmin` fallback | Cache de titulos | Cache | Remover fallback na 13D apos local cache completo | Medio |
| `src/server/cache/season-cache.ts` | `supabaseAdmin` fallback | Cache temporadas/episodios | Cache | Remover fallback na 13D | Medio |
| `src/server/cache/ratings-cache.ts` | `supabaseAdmin` fallback | Cache ratings externos | Cache | Remover fallback na 13D | Medio |
| `src/server/cache/external-ids-cache.ts` | `supabaseAdmin` fallback | Cache ids externos | Cache | Remover fallback na 13D | Medio |
| `src/server/cache/availability-cache.ts` | `supabaseAdmin` fallback | Availability antiga/nova | Cache/streaming | Remover fallback na 13D | Medio |
| `src/server/continuity/continuity-section-cache.ts` | `supabaseAdmin` fallback | Cache persistente | Continuity cache | Remover fallback na 13D | Baixo/medio |
| `src/server/continuity/continuity-state-cache.ts` | `supabaseAdmin` | State cache legado | Continuity | Deixar para 13C | Medio |
| `src/server/continuity/hero-candidates.ts` | `supabaseAdmin` fallback | Hero local/fallback | Hero | Remover fallback na 13D | Baixo/medio |
| `src/server/continuity/hero-impressions.ts` | `supabaseAdmin` fallback | Impressoes Hero | Hero | Remover fallback na 13D | Baixo |
| `src/server/engine-logger/persistence.ts` | `supabaseAdmin` fallback | Logs engine | Logs | Remover fallback na 13D | Baixo |
| `src/server/episodes/episode-progress-service.ts` | `supabaseAdmin` fallback | Progresso episodios | Episodes | Remover fallback na 13D | Baixo |
| `src/server/library/library-service.ts` | `supabaseAdmin` fallback | Biblioteca | Library | Remover fallback na 13D | Baixo |
| `src/server/personalization/title-feedback-engine.ts` | `supabaseAdmin` fallback | Feedback engine | Personalization | Remover fallback na 13D | Medio |
| `src/server/rate-limits/premium-api-budget.ts` | `supabaseAdmin` fallback | Budget APIs | Rate limit | Remover fallback na 13D | Baixo |
| `src/server/runtime/series-episode-runtimes.ts` | `supabaseAdmin` | Runtime de episodios | Runtime | Migrar para Prisma em 13C | Baixo/medio |
| `src/server/search/fuzzy-title-search.ts` | `supabaseAdmin` | Busca cache local legado | Search | Migrar para Prisma em 13C | Medio |
| `src/server/state/user-title-state.ts` | `supabaseAdmin` fallback | State materializado | User state | Remover fallback na 13D | Baixo |
| `src/server/streaming/availability-fallback-state.ts` | `supabaseAdmin` fallback | Estado fallback availability | Streaming | Remover fallback na 13D | Baixo |
| `src/server/streaming/batch-availability-refresh.ts` | `supabaseAdmin` | Preferencias e availability | Streaming | Deixar para 13C junto de streaming preferences | Medio |

## Wrappers, dependencias e envs

| Arquivo | Tipo de dependencia | Motivo atual | Modulo | Status | Risco |
| --- | --- | --- | --- | --- | --- |
| `package.json` | `@supabase/ssr`, `@supabase/supabase-js` | Auth/fallback legado | Dependencias | Remover apenas na 13D | Alto se removido agora |
| `.env.example`, `.env.local.example` | envs Supabase | Auth/fallback legado | Config | Atualizar apenas na 13D | Medio |
| `src/server/supabase/admin.ts` | `@supabase/supabase-js`, envs | Client service-role | Wrapper | Remover na 13D | Alto se removido agora |
| `src/server/supabase/server.ts` | `@supabase/ssr`, envs | Client server auth | Wrapper | Remover na 13D | Alto |
| `src/server/supabase/client.ts` | `@supabase/ssr`, envs | Client browser auth | Wrapper | Remover na 13D | Alto |
| `src/lib/supabase/server.ts` | re-export | Compatibilidade | Wrapper | Remover na 13D | Medio |
| `src/lib/supabase/client.ts` | re-export | Compatibilidade | Wrapper | Remover na 13D | Medio |
| `supabase/migrations/*` | SQL legado | Historico schema Supabase | Legado | Arquivar/remover depois de baseline Prisma validado | Medio |
| `supabase/functions/recalculate-curadoria/index.ts` | Supabase Edge Function | Job remoto legado | Legado | Remover/substituir na 13D | Medio |

## Prisma migrations

`prisma/migrations/00000000000000_init/migration.sql` foi criado via:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

Nao foi executado `npx prisma migrate dev --name init` porque o banco local atual ja foi criado por `db push`. Rodar `migrate dev` diretamente nesse historico pode pedir reset/drift e quebrar dados locais. Antes da producao real:

1. Validar a migration baseline contra um banco MySQL vazio.
2. Em banco existente equivalente ao schema atual, marcar baseline como aplicada com `prisma migrate resolve --applied 00000000000000_init` somente apos diff limpo.
3. Usar `prisma migrate deploy` em ambientes novos.

## Proximas fases

| Fase | Objetivo |
| --- | --- |
| 13B | Auth real: Auth.js/NextAuth, troca de `getCurrentUser()`, UI/hook/proxy e sync usuarios |
| 13C | Migrar ultimas rotas/engines: `streaming-preferences`, `for-you`, `sorteio`, `agenda-engine`, admin/backfill/hydrate, `rating_aggregates` |
| 13D | Remocao final: dependencias npm, wrappers `src/server/supabase`/`src/lib/supabase`, envs, functions/migrations Supabase legadas |
