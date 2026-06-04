# POPLOG-first Migration Status

## Identidade principal

`POPLOG_ID` é a identidade central interna.  
IDs externos são aliases/metadados — nunca fonte primária de fluxo público.

## Aliases permitidos

`tmdb_id`, `imdb_id`, `tvdb_id`, `trakt_id`, `balloonerismm_id`, `slug`

## Regra de TMDB

- `tmdb_id` pode existir apenas como alias histórico e chave de lookup local.
- `poster_path`, `backdrop_path`, `vote_average`, `tmdb_payload` podem persistir como campos legados no banco.
- A API TMDB (`api.themoviedb.org`) não pode ser chamada em nenhum fluxo — público, admin ou debug.
- Imagens já salvas no cache local continuam sendo exibidas normalmente.

## Fluxos públicos migrados

| Fluxo | Status |
|---|---|
| Search | POPLOG-first |
| Title details | POPLOG-first (legacy fallback TMDB removido) |
| Discover | POPLOG-first |
| People | POPLOG-first |
| Sorteio | POPLOG-first |
| Watchlist / live | POPLOG-first |
| Watchlist Picks | POPLOG-first |
| Agenda principal | POPLOG-first |
| Social highlights | POPLOG-first |
| Movie comments | POPLOG-first |
| For You | POPLOG-first (Balloonerismm getRelated + local DB fallback) |

## Hard removal of TMDB operational infrastructure

Realizado na branch `feature/balloonerismm-api-migration` (etapas 16–19 unificadas):

- `src/server/api-clients/tmdb/client.ts` — **deletado**
- `src/server/sync/sync-tmdb-title.ts` — **deletado**
- `src/server/sync/sync-tmdb-season.ts` — **deletado**
- `/api/debug/tmdb` — retorna 410 Gone (sem import TMDB)
- `/api/admin/hydrate-library` — retorna 410 (TMDB hydration removed)
- `/api/admin/hydrate-series-episodes` — retorna 410 (TMDB season hydration removed)
- `continuity-background-refresh.ts` — sync TMDB removido (no-op)
- `user-title-state.ts` — refresh via TMDB removido (no-op)
- `social-context-builder.ts` — sync TMDB removido (stub minimalista)
- `get-title-page-data.ts` — legacy TMDB fallback removido (retorna null)
- `sync-availability.ts` — `fetchTmdbWatchProviders` retorna null (sem API call)
- `editorial-origin-ranker.ts` — details fetch TMDB removido (retorna null)
- `agenda-engine.ts` — `fetchLegacyAgenda` retorna arrays vazios tipados
- `discover-service.ts` — todas as chamadas TMDB removidas (retorna [])
- `priority-monitor.ts` — TMDB fetch removido (retorna [])
- `home-api.ts` — todas as chamadas TMDB removidas (retorna [])
- `lib/images/fetch.ts` — `fetchTitleImages` retorna {} (sem API call)
- `lib/radar/tmdb-retrofill.ts` — permanentemente desativado
- `lib/radar/tmdb-trending-feed.ts` — permanentemente desativado
- `lib/ics-enricher.ts` — permanentemente desativado
- `/api/ics/agenda` — cinema releases e enriquecimento TMDB removidos
- `/api/ics/enrich` — retorna disabled (sem import TMDB)
- `/api/poplog3/search/discovery` — retorna disabled (sem TMDB)
- `/api/poplog3/discover/special` — retorna disabled (sem TMDB)

## ICS / Radar

TMDB completamente removido do pipeline ICS/Radar:

| Módulo | Status |
|---|---|
| ICS Enrichment | permanentemente desativado |
| TMDB Retrofill | permanentemente desativado |
| TMDB Trending Feed | permanentemente desativado |
| Cinema Releases | removido do pipeline |

## Estado atual

O sistema opera em modo POPLOG-first com infraestrutura TMDB operacional **completamente removida**.  
`tmdb_id` e campos legados (`poster_path`, `backdrop_path`, `vote_average`, `tmdb_payload`) 
continuam existindo apenas como aliases/campos de banco — sem disparar nenhuma chamada TMDB.

**Lint:** 0 errors  
**Build:** compilado com sucesso

## Pendências futuras

- Admin hydration via Balloonerismm
- Season hydration via TVDB
- Image backfill via providers alternativos
- Substituir `buildSocialContextFromTmdb` (sem callers ativos, pode ser removida)
- Melhorar People com fonte alternativa
- Refinar ICS / Radar com TVDB / agenda local
- Melhorar recomendações com modelo local / cache
