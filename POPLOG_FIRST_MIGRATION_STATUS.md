# POPLOG-first Migration Status

## Identidade principal

`POPLOG_ID` é a identidade central interna.  
IDs externos são aliases/metadados — nunca fonte primária de fluxo público.

## Aliases permitidos

`tmdb_id`, `imdb_id`, `tvdb_id`, `trakt_id`, `balloonerismm_id`, `slug`

## Regra de TMDB

- `tmdb_id` pode existir como alias histórico e chave de lookup local.
- A API TMDB (`api.themoviedb.org`) não pode ser fallback automático em fluxos públicos.
- A API TMDB não pode ser fonte primária de nenhum fluxo público.

## Fluxos públicos migrados

| Fluxo | Status |
|---|---|
| Search | POPLOG-first |
| Title details | POPLOG-first (legacy fallback apenas para títulos sem cobertura POPLOG) |
| Discover | POPLOG-first |
| People | POPLOG-first |
| Sorteio | POPLOG-first |
| Watchlist / live | POPLOG-first |
| Watchlist Picks | POPLOG-first |
| Agenda principal | POPLOG-first |
| Social highlights | POPLOG-first |
| Movie comments | POPLOG-first |
| For You | POPLOG-first (Balloonerismm getRelated + local DB fallback) |

## ICS / Radar

TMDB está controlado por feature flags — todas desligadas por padrão:

| Flag | Comportamento padrão |
|---|---|
| `ENABLE_TMDB_ICS_ENRICHMENT` | `false` (code default) |
| `ENABLE_TMDB_RETROFILL` | `false` (code default) |
| `ENABLE_TMDB_TRENDING_FEED` | `false` (via `.env`) |

## Admin / Dev / Debug

Rotas técnicas que ainda utilizam TMDB são manuais, protegidas e isoladas:

| Rota | Proteção |
|---|---|
| `/api/debug/tmdb` | `isAdminRequest` |
| `/api/admin/hydrate-library` | `x-admin-secret` |
| `/api/admin/hydrate-series-episodes` | `x-admin-secret` |
| `/api/dev/trakt-*` | `isAdminRequest` |

## Detalhes de ocorrências TMDB auditadas

Todos os usos restantes de `syncTmdbTitle` / `syncTmdbSeason` / `api.themoviedb.org`
foram classificados como:

- **Infraestrutura** — clientes e definições (`tmdb/client.ts`, `sync-tmdb-*.ts`)
- **Legacy fallback explícito** — `get-title-page-data.ts` dispara somente quando
  `primarySource === "legacy"` e o título ainda não tem cobertura POPLOG-first; emite
  `console.warn` auditável
- **Background sync opt-in** — `continuity-background-refresh.ts` e
  `user-title-state.ts` disparam apenas quando chamados com flags específicas por
  rotas admin
- **Código exportado sem chamadas ativas** — `buildSocialContextFromTmdb` em
  `social-context-builder.ts` é exportado mas sem callers no codebase atual
- **Rotas admin/debug protegidas** — guard obrigatório em todas

## Estado atual

O sistema opera em modo POPLOG-first.  
TMDB permanece apenas como alias histórico e em rotas técnicas controladas.

**Lint:** 0 errors (warnings pré-existentes permitidos)  
**Build:** compilado com sucesso

## Próximos upgrades

- Persistir `poplogId` diretamente nas tabelas de user state.
- Substituir hidratação admin TMDB por Balloonerismm / TVDB.
- Remover ou substituir `buildSocialContextFromTmdb` (sem callers ativos).
- Melhorar People com fonte alternativa ao TMDB.
- Refinar ICS / Radar com TVDB / agenda local.
- Melhorar recomendações com modelo local / cache.
