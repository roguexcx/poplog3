# Etapa 5 - Auditoria de detalhes de titulo POPLOG-first

Branch: `feature/balloonerismm-api-migration`

## Escopo auditado

- `src/app/title/[mediaType]/[id]/page.tsx`
- `src/app/api/title/[mediaType]/[id]/route.ts`
- `src/app/api/poplog3/titles/[mediaType]/[id]/route.ts`
- `src/server/titles/get-title-page-data.ts`
- `src/server/sync/sync-tmdb-title.ts`
- `src/server/sync/sync-tmdb-season.ts`
- `src/server/source-engine/engine.ts`
- `src/server/source-engine/adapters/balloonerismm-adapter.ts`

## Achados

### A. Chamada real a API TMDB - substituir/remover futuramente

- `src/server/sync/sync-tmdb-title.ts`
  - Funcao: `syncTmdbTitle`.
  - Uso: chama `tmdbFetch` em `/${mediaType}/${id}` com `append_to_response`.
  - Prioridade: alta. Hoje e o caminho principal de `getTitlePageData`.

- `src/server/sync/sync-tmdb-season.ts`
  - Funcao: `syncTmdbSeason`.
  - Uso: chama temporadas TMDB por `seriesTmdbId`.
  - Prioridade: alta para series, mas manter como fallback nesta etapa.

- `src/server/titles/get-title-page-data.ts`
  - Funcao: `getTitlePageData`.
  - Uso: chama `syncTmdbTitle` no inicio e `fetchTmdbCollection` para colecoes.
  - Prioridade: alta. Deve ganhar caminho POPLOG/Balloonerismm-first e marcar TMDB como fallback legado.

- `src/app/api/title/[mediaType]/[id]/route.ts`
  - Rota: API legada de titulo.
  - Uso: chama `syncTmdbTitle` diretamente.
  - Prioridade: alta. Pode ser mantida como fallback, mas nao deve ser o caminho novo.

### B. Uso de tmdb_id como alias externo - pode permanecer

- `title_external_ids`
  - Mapeia `tmdb_id`, `imdb_id`, `tvdb_id`, `trakt_id`, `watchmode_id`, `motn_id`.
  - Deve ser tratado como tabela de aliases externos.

- `src/server/source-engine/hydrate-catalog-results.ts`
  - Usa `tmdbId` apenas como alias/resolucao local quando existente.
  - Esta alinhado com POPLOG-first.

### C. Uso de tmdb_id como identidade estrutural - precisa refatorar

- `src/app/title/[mediaType]/[id]/page.tsx`
  - Assume que `id` e numerico e rejeita `tt...`, slug ou `poplogId`.
  - Chama `getTitlePageData` com `id: number`.

- `src/app/api/poplog3/titles/[mediaType]/[id]/route.ts`
  - Converte `id` para `Number` e retorna erro "Invalid TMDB id".

- `src/server/titles/get-title-page-data.ts`
  - Tipo `GetTitlePageDataOptions.id` e `number`.
  - Valida retorno por `title.tmdb_id === id`.
  - Usa `id` em biblioteca, ratings, disponibilidade, progresso e recomendacoes.

- `src/server/cache/title-cache.ts`, `src/server/repositories/title-cache.repository.ts`
  - Cache ainda chaveado por `tmdbId + mediaType` por limitacao de schema atual.
  - Deve ser encarado como compatibilidade historica ate existir POPLOG_ID persistente como chave funcional.

### D. Dependencia visual/imagem TMDB - deixar para etapa de imagens

- `src/server/titles/get-title-page-data.ts`
  - Usa `buildTmdbRawUrl` para poster/backdrop/perfis/recomendacoes.

- `src/components/images/TmdbImage.tsx`, `src/components/images/CatalogImage.tsx`, `src/lib/images/url.ts`
  - Ainda constroem URLs de imagem TMDB.
  - Fora do escopo desta etapa.

## Campos minimos para renderizar a pagina de titulo

- `id`
- `mediaType`
- `title`
- `originalTitle`
- `year`
- `releaseDate` ou `firstAirDate`
- `overview`
- `posterUrl`
- `backdropUrl`
- `runtime` ou `episodeRunTimeMinutes`
- `voteAverage`
- `genres`
- `cast`
- `crew`
- `trailer`
- `ratings`
- `userState`
- `providers`
- `availability`
- `recommendations`
- `cacheInfo`

## Direcao da Etapa 5

- Criar resolver `resolvePoplogTitleIdentity`.
- Criar loader `getPoplogTitleDetails`.
- Expor debug admin para resolucao e detalhes.
- Integrar rota/pagina por caminho POPLOG/Balloonerismm-first quando houver identificador resolvivel.
- Manter `syncTmdbTitle`/`syncTmdbSeason` como fallback legado temporario, sem novas chamadas TMDB.
