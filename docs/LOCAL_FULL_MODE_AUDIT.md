# Auditoria de Dependências Supabase — Local Full Mode

> Gerado em 2026-06-03 (Fase 9).
> Mapeia todos os arquivos que ainda importam ou usam Supabase quando o modo local completo está ativo.

## Legenda

| Coluna | Descrição |
|---|---|
| Arquivo | Path relativo a `src/` |
| Tipo | auth · data · admin · client-ui · debug |
| Flag local? | Flag que bypassa o caminho Supabase, se existir |
| Risco em local full | O que acontece se Supabase não estiver configurado |
| Prioridade de migração | alta · média · baixa · n/a (fora do escopo) |

---

## A — Auth

| Arquivo | Tipo | Flag local? | Risco em local full | Prioridade |
|---|---|---|---|---|
| `proxy.ts` | auth | `POPLOG_LOCAL_AUTH_ENABLED` (via middleware) | Com flag ON: bypass ativo; com flag OFF: redirect para `/` | n/a — comportamento esperado |
| `server/auth/get-current-user.ts` | auth | `POPLOG_LOCAL_AUTH_ENABLED` | Com flag ON: usa Prisma; com flag OFF: usa Supabase | Migrada (Fase 8) |
| `server/supabase/server.ts` | auth | — | Chamada de `createSupabaseServerClient()` falha se URL vazia | Baixa — só chamado quando flags locais estão OFF |
| `server/supabase/admin.ts` | admin-client | — | **Corrigido Fase 9**: não lança mais em init; falha apenas em uso real | — |

---

## B — Dados com fallback local (flag-aware)

Estes arquivos têm branch local; o caminho Supabase só é ativado quando a flag está OFF.

| Arquivo | Tabelas Supabase | Flag que bypassa | Status |
|---|---|---|---|
| `server/continuity/continuity-section-cache.ts` | `continuity_section_cache` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `server/cache/title-cache.ts` | `poplog3_titles` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `server/cache/season-cache.ts` | `poplog3_seasons`, `poplog3_episodes` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `server/cache/ratings-cache.ts` | `title_ratings` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `server/cache/external-ids-cache.ts` | `external_ids_cache` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `lib/personalization/feedback.ts` | `user_title_feedback` | `POPLOG_LOCAL_FEEDBACK_ENABLED` | Migrada |
| `app/api/user/feedback/route.ts` | `user_title_feedback`, `user_title_state`, `user_titles` | `POPLOG_LOCAL_FEEDBACK_ENABLED` | Migrada |
| `app/api/user/not-interested/route.ts` | `user_title_feedback`, `user_titles`, `poplog3_titles` | `POPLOG_LOCAL_FEEDBACK_ENABLED` | Migrada |
| `app/api/user/feedback/batch/route.ts` | `user_title_feedback` | `POPLOG_LOCAL_FEEDBACK_ENABLED` | Migrada |
| `server/library/library-service.ts` | `user_titles` | `POPLOG_LOCAL_LIBRARY_ENABLED` | Migrada |
| `app/api/library/route.ts` | `user_titles` | `POPLOG_LOCAL_LIBRARY_ENABLED` | Migrada |
| `app/api/library/title/route.ts` | `user_titles` | `POPLOG_LOCAL_LIBRARY_ENABLED` | Migrada |
| `server/state/user-title-state.ts` | `user_title_state` | `POPLOG_LOCAL_USER_STATE_ENABLED` | Migrada |
| `server/episodes/episode-progress-service.ts` | `user_episodes`, `user_title_state`, `user_titles` | `POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED` | Migrada |
| `server/ratings/user-rating-service.ts` | `user_ratings` | `POPLOG_LOCAL_USER_RATINGS_ENABLED` | Migrada |
| `server/streaming/user-provider-preferences.ts` | `user_streaming_preferences`, `streaming_providers` | `POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED` | Migrada |
| `app/api/user/streaming-preferences/route.ts` | `user_streaming_preferences`, `streaming_providers` | `POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED` | Migrada |
| `server/runtime/series-episode-runtimes.ts` | `poplog3_episodes` | `POPLOG_LOCAL_CACHE_ENABLED` | Migrada |
| `server/streaming/availability-fallback-state.ts` | `poplog3_availability_fallback_state` | `POPLOG_LOCAL_AVAILABILITY_ENABLED` | Migrada |
| `app/api/poplog3/acompanhando/route.ts` | `user_titles`, `user_curadoria_state`, `user_watching` | `POPLOG_LOCAL_ACOMPANHANDO_ENABLED` | GET migrado; POST ainda usa Supabase |
| `app/api/poplog3/continuity/hero/route.ts` | `hero_impressions`, `user_title_state`, `user_titles` | `POPLOG_LOCAL_HERO_ENABLED` | Migrada |
| `server/continuity/hero-candidates.ts` | `poplog3_title_availability`, `user_title_state`, `user_titles`, `poplog3_titles` | `POPLOG_LOCAL_HERO_ENABLED` | Migrada |
| `server/continuity/hero-impressions.ts` | `hero_impressions` | `POPLOG_LOCAL_HERO_ENABLED` | Migrada |
| `app/api/poplog3/continuity/continue/route.ts` | `user_title_state` via cache | `POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED` | Migrada |
| `app/api/poplog3/continuity/recently-watched/route.ts` | `user_title_state` via cache | `POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED` | Migrada |
| `app/api/poplog3/continuity/new-episodes/route.ts` | `user_title_state` via cache | `POPLOG_LOCAL_NEW_EPISODES_ENABLED` | Migrada |
| `app/api/poplog3/continuity/watchlist-picks/route.ts` | `user_title_state` via cache | `POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED` | Migrada |
| `app/api/radar/route.ts` | `user_title_state` (modo personal) | `POPLOG_LOCAL_RADAR_ENABLED` | Migrada |
| `app/api/poplog3/agenda/route.ts` | `user_titles`, `user_title_state`, `poplog3_title_availability` | `POPLOG_LOCAL_AGENDA_ENABLED` | Migrada |

---

## C — Dados SEM fallback local (ainda usa Supabase sempre)

⚠️ Estes arquivos chamam Supabase mesmo com local full mode ativo. Não quebram o servidor (admin.ts corrigido), mas os endpoints podem retornar erro ou resultado vazio se Supabase não estiver configurado.

| Arquivo | Tabelas Supabase | Risco em local full | Próxima ação sugerida |
|---|---|---|---|
| `app/api/user/streaming-preferences/route.ts` | `streaming_providers`, `user_streaming_preferences` | Erro 500 se sem Supabase | Migrar `user_streaming_preferences` para Prisma |
| `app/api/watchlist/live/route.ts` | `poplog3_titles`, `poplog3_title_availability` | Erro ou resultado vazio | Redirecionar para cache/Prisma local |
| `app/api/user/genre-stats/route.ts` | `user_titles` | Erro ou lista vazia | Migrar para `user_title_state` local |
| `app/api/user/for-you/route.ts` | `user_title_feedback`, queries diversas | Degradação parcial | Migrar na Fase 10+ |
| `app/api/trending/route.ts` | `poplog3_titles` + joins | Resultado vazio/erro | Migrar cache de trending para Prisma |
| `server/agenda/agenda-engine.ts` | `user_titles`, `poplog3_titles`, `poplog3_title_availability` | Agenda pode retornar vazia | Substituir por helpers locais já existentes |
| `server/sorteio/sorteio-engine.ts` | `user_titles`, diversos | Sorteio pode falhar | Migrar em fase futura |
| `server/search/fuzzy-title-search.ts` | `poplog3_titles` | Busca falha | Migrar para Prisma |
| `server/runtime/series-episode-runtimes.ts` | `poplog3_episodes` | Runtimes ausentes | Migrar para Prisma |
| `server/streaming/availability-fallback-state.ts` | `poplog3_availability_fallback_state` | Estado de fallback ausente | Migrar para Prisma |
| `server/streaming/batch-availability-refresh.ts` | `catalog_availability` | Refresh falha | Migrar para Prisma |
| `server/ratings/rating-aggregate-service.ts` | `rating_aggregates` | Community ratings ausentes | Reimplementar no Prisma |
| `app/api/poplog3/continuity/upcoming-episodes/route.ts` | `user_title_state`, `poplog3_episodes` | Upcoming retorna vazio | Migrar com flag própria |
| `app/api/poplog3/agenda/v2/route.ts` | idem agenda-engine | Agenda v2 pode falhar | Migrar com flag |
| `server/continuity/continuity-state-cache.ts` | `user_title_state` | Não chamado quando flags locais ON (rotas fazem bypass) | Baixa prioridade — bypass já existe nas rotas |

---

## D — UI / Client-side (fora do escopo desta migração)

Estes arquivos usam Supabase no cliente (browser). Não impactam o servidor local.

| Arquivo | Uso |
|---|---|
| `hooks/useAuth.ts` | `supabase.auth.onAuthStateChange` |
| `components/auth/LoginDrawer.tsx` | UI de login Supabase |
| `components/layout/Sidebar.tsx` | Auth state client-side |
| `app/profile/ProfilePageClient.tsx` | Tipo `User` do Supabase |
| `features/home/HomeMemberSections.tsx` | Tipo `User` do Supabase |
| `context/UserDataContext.tsx` | Queries client-side de `user_titles` |
| `features/home/components/WatchlistVivaSection.tsx` | Update client-side de `user_titles` |
| `lib/user-title-service.ts` | Queries client-side |
| `lib/episodes/episode-validators.ts` | Queries client-side |
| `lib/supabase/client.ts` | Factory do cliente browser |
| `lib/supabase/server.ts` | Re-export de `createSupabaseServerClient` |

---

## E — Debug / Admin (baixa prioridade)

| Arquivo | Uso | Notas |
|---|---|---|
| `app/api/debug/config/route.ts` | Exibe configuração de env | Referencia `NEXT_PUBLIC_SUPABASE_URL` |
| `app/api/debug/supabase/route.ts` | Testa conexão Supabase | Deve falhar graciosamente se sem Supabase |
| `app/api/debug/local-db/acompanhando-diff/route.ts` | Diff local vs Supabase | Requer ambos para funcionar |
| `app/api/admin/backfill-title-state/route.ts` | Backfill admin | Requer Supabase |
| `app/api/admin/hydrate-library/route.ts` | Hydrate admin | Requer Supabase |
| `app/api/admin/hydrate-series-episodes/route.ts` | Hydrate admin | Requer Supabase |
| `app/api/admin/radar-personal-debug/route.ts` | Debug radar | Requer auth |
| `app/api/admin/radar-cache-flush/route.ts` | Flush cache radar | Requer Supabase |

---

## Variáveis de ambiente Supabase

| Variável | Onde usada | Em local full mode |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `server/supabase/admin.ts`, `server.ts`, `client.ts`, `proxy.ts` | Pode ficar vazia — admin.ts usa placeholder |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `server/supabase/server.ts`, `client.ts`, `proxy.ts` | Pode ficar vazia |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/supabase/admin.ts` | Pode ficar vazia — usa placeholder |

---

## Correções aplicadas nesta fase (Fase 9)

| Arquivo | Problema | Correção |
|---|---|---|
| `server/supabase/admin.ts` | Lançava erro em init se env vars ausentes | Removido `throw`, usa placeholder URLs |
| `src/middleware.ts` | Proxy não estava wired como middleware Next.js | Criado `middleware.ts` com bypass por `POPLOG_LOCAL_AUTH_ENABLED` |

---

## Próximos passos sugeridos (Fase 10+)

1. Migrar `upcoming-episodes` com flag `POPLOG_LOCAL_UPCOMING_ENABLED`
2. Migrar `continuity-state-cache.ts` para usar flag `POPLOG_LOCAL_USER_STATE_ENABLED` (sem circular dep)
3. Migrar `agenda-engine.ts` — helpers locais já existem em `continuity-local.service.ts`
4. Migrar `series-episode-runtimes.ts` — dados disponíveis em `poplog3_episodes`
5. Migrar `rating-aggregate-service.ts` — reimplementar `rating_aggregates` no Prisma
6. Migrar `streaming-preferences` — criar tabela `user_streaming_preferences` no Prisma
7. Typecheck/build global (Fase 10): corrigir erros em `api-history`, `balloonerismm`, `tvdb`
