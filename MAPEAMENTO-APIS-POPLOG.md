# Mapeamento Geral de APIs e Dependências — POPLOG v3

> Levantamento completo das integrações externas e internas, organizado por
> fonte e por área do site. Base para decisões de otimização.
> Gerado em 2026-06-24 · branch `feature/balloonerismm-api-migration`.

---

## 1. Inventário de fontes de dados

### 1.1 APIs externas (clients em `src/server/api-clients/`)

| Fonte | Client | Base URL | Auth | Papel atual | Cache | Flag de ativação |
|-------|--------|----------|------|-------------|-------|------------------|
| **Balloonerismm** (proxy IMDb-first / "JustWatch" na atribuição) | `balloonerismm/client.ts` | `https://api.balloonerismm.workers.dev` | `X-API-Key` opcional | **Fonte primária de catálogo**: metadata, busca, pessoas, temporadas/episódios, providers, ratings, vídeos, financeiro parcial | Proc-cache em memória (TTL 1h, stale ×3) + in-flight dedup + cooldown por path + token bucket (10 req/s) + semáforo de concorrência | `BALLOONERISMM_ACTIVE` |
| **Trakt.tv** | `trakt/client.ts` | `https://api.trakt.tv` | `Client-ID` (sem OAuth p/ leitura) | **Fallback de catálogo + fonte canônica**: filmes/séries, trending, popular, discover, related, episódios, traduções pt-BR, comentários/comunidade, **Radar (calendário)** | Proc-cache (TTL 24h, stale 7d) + cooldown 60s em 429, write throttle 1 req/s | `TRAKT_ACTIVE`, `TRAKT_INDEX_ENABLED` |
| **TheTVDB v4** | `tvdb/client.ts` | `https://api4.thetvdb.com/v4` | JWT via `POST /login` (30d) | **Episódios/temporadas** (merge canônico com Trakt): stills, pt-BR, paginação real | Token em memória 28d, TTL 24h | `TVDB_ACTIVE` + `TVDB_API_KEY` (⚠️ 250 req/mês free) |
| **OMDb** | `omdb/client.ts` | `https://www.omdbapi.com/` | `apikey` | Ratings externos (IMDb/RT/Metacritic), prêmios — página de título | `next.revalidate` 30 dias | `OMDB_API_KEY` |
| **Wikidata** | `wikidata/client.ts` | `query.wikidata.org/sparql` + `wikidata.org/w/api.php` | User-Agent obrigatório | **Financeiro primário externo**: orçamento (P2130) / bilheteria (P2142) por IMDb ID | Cache `poplog_title_financials_cache` (90d found / 14d empty) | sempre que faltar dado |
| **Wikipedia** | `wikipedia/client.ts` | `pt/en.wikipedia.org/w/api.php` | User-Agent | **Fallback financeiro**: infobox (orçamento/bilheteria) quando Wikidata vazia | mesmo cache financeiro | fallback automático |
| **JustWatch (GraphQL não-oficial)** | `streaming/justwatch-graphql-unofficial-source.ts` | GraphQL JustWatch | — | Enriquecimento de providers/canais (complementa availability) | via availability cache | `isJustWatchUnofficialEnabled` / `isJustWatchChannelEnrichmentEnabled` |

### 1.2 Fontes legadas / desativadas (referência histórica)

- **TMDB** — removido como infraestrutura operacional (Etapas 16–19). Restam: tipos
  (`src/types/tmdb.ts`), `tmdbId` sintético derivado de imdbId, paths de imagem
  canônicos persistidos no DB, e `ENABLE_TMDB_TRENDING_FEED=false` (feed desligado).
- **Watchmode / Movie of the Night (MotN)** — citados em `attribution/api-sources.ts`
  e `strategies/api-priority.ts`, mas **stack removida** (Etapa "global-cleanup").
  ⚠️ Esses dois arquivos de atribuição/prioridade estão **stale** e ainda listam TMDB,
  Watchmode e MotN como ativos — divergem do código real.
- **Banco de Séries** — apenas referência em atribuição, sem client ativo.

### 1.3 Fonte interna primária

- **PostgreSQL via Prisma** (`prisma/schema.prisma`, `src/server/db/client.ts`) —
  cache canônico de tudo: `poplog3Title`, `catalog_availability`, `season_cache`,
  `title_financials_cache`, caches de people/credits/search, user state, listas,
  progresso de episódios, engine-logger. É a **primeira camada consultada** em
  quase todos os fluxos (POPLOG-first).

---

## 2. Mapeamento por área do site

Legenda de fluxo: `→` ordem de fallback · **DB** = Postgres local.

### Home (`src/features/home/`, `trending-feed.ts`)
- **Trending / Hero rotativo**: Trakt Index TOP 50 (`lib/trakt-index/canonical.ts`) é a
  fonte primária → `catalogGetTrending` (Trakt adapter) → **DB** fallback.
- **Para Você (preview)**: `/api/user/for-you` (ver abaixo).
- **Watchlist Viva / Continuar**: continuity services sobre **DB** + availability.
- **Imagens**: `resolveCatalogImage` / `CatalogImage` → proxy `/api/images/proxy`.
- **Cache**: `continuity-section-cache`, `TRENDING_CACHE_TTL_MS = 30min`.
- **Risco**: dependência de Trakt Index para o Hero; sem ele, cai para DB (pode ficar
  estático). Availability hidratada item a item (custo).

### Para Você (`/api/user/for-you/route.ts`, `recommendations/balloon-engine.ts`)
- **Relacionados**: Balloonerismm `/recommendations` + `/similar` por seed (primário).
- **Hidratação**: Trakt por imdbId (IDs canônicos, pt-BR, imagens).
- **Fallback**: **DB** local (paths TMDB canônicos).
- **Engine**: RRF k=60 combinando Balloonerismm + Trakt (Etapa 42), dedup por imdbId.
- **Cache**: `continuity-section-cache`, pool cache, cooldown granular por path.
- **Risco**: **Balloonerismm é indispensável aqui** — é a fonte de ranking. Latência
  alta (2 chamadas × até 12 seeds). Mitigado por in-flight dedup + cooldown + pool.

### Radar (`src/server/radar-trakt/`, `/api/radar`)
- **Fonte primária**: **Trakt Calendar** (`trakt-calendar.client.ts`) — shows + movies
  + anticipated/discovery.
- **Enriquecimento**: **DB** local (retrofill de metadata/imagens), availability.
- **Pipeline**: normalize → group → score → buckets → filters.
- **Cache**: `radar-cache.service.ts` (`RADAR_TRAKT_CACHE_VERSION = 2`), flush via admin.
- **Risco**: 100% Trakt para o calendário. Balloonerismm **não** participa do Radar.

### Busca (`/api/search`, `src/server/poplog-search/`, `source-engine/engine.ts`)
- **Títulos**: `catalogSearch` → Balloonerismm `/search/multi` (primário) → Trakt fallback.
- **Pessoas**: Balloonerismm `/search/person` (paralelo) + página `/person/[id]`.
- **Empresas**: Balloonerismm `/search/company`.
- **Dedup**: por imdbId, filtro de não-títulos (Etapa 44).
- **Cache**: `entity-cache.ts` + tabelas de people/credits/search (migration 9).
- **Risco**: **Balloonerismm é a fonte primária de busca**. Se cair, Trakt cobre títulos
  mas **não pessoas/empresas** → busca de pessoas fica indisponível.

### Página de Título (`server/titles/get-title-page-data.ts`)
A área de maior fan-out de APIs. Fluxo:
- **Detalhes base**: `getPoplogTitleDetails` → Balloonerismm `/movie/{id}` ou `/tv/{id}`
  (primário) → Trakt enrichment (`getTraktShowEnrichment`/`getTraktMovieEnrichment`).
- **Temporadas/Episódios**: Series Canonical Engine → **TVDB + Trakt em paralelo**
  (merge/dedup) → Balloonerismm fallback (`canonical-season-resolver.ts`).
- **Providers / Onde Assistir**: camada global de availability (ver abaixo).
- **Financeiro (budget/revenue)**: Balloonerismm (se já vier completo) → **DB** cache →
  Wikidata → Wikipedia infobox.
- **Ratings**: OMDb (IMDb/RT/Metacritic) + agregado público local.
- **Related/Recomendações**: Balloonerismm `/recommendations`+`/similar` → Trakt hidrata.
- **Trailers/Vídeos**: Balloonerismm `/videos` (links IMDb/YouTube).
- **Comentários**: Trakt (traduzidos pt-BR).
- **Franquias/Universo**: serviços locais sobre **DB**.
- **Cache**: `continuity-section-cache` para related (TTL 6h), upsert no DB de tudo.
- **Risco**: maior superfície de latência — pode disparar 5–7 APIs distintas. Mitigado
  por DB-first + caches longos. Balloonerismm indispensável para detalhes base de
  títulos que só existem nele (synthetic id negativo).

### Biblioteca (`server/library/`, `features/library/`)
- **Identidade**: `library-identity-index.ts` (sem hidratar — só IDs).
- **Availability**: camada global hidratada em lote.
- **Imagens/metadata**: **DB** local; `resolveCatalogImage`.
- **Risco**: baixo — opera majoritariamente sobre **DB**. APIs externas só na hidratação
  de availability/badges.

### Listas (`server/lists/`, `/api/lists/`)
- **Fonte**: 100% **DB** local (`user_lists`, migration 10). Sem API externa direta.
- **Hidratação de cards**: availability + imagens via camadas globais.
- **Risco**: nenhum externo relevante.

### Providers / Onde Assistir (`server/availability/availability-service.ts`)
Camada GLOBAL única (Biblioteca, Home, Busca, Título, Sorteio consomem):
1. Cache persistente `catalog_availability` (por imdbId, inclui estado negativo).
2. **Balloonerismm `/watch/providers`** (ao vivo, região BR padrão) — primário.
3. Fallback: cache local legado (TMDB/Watchmode/MotN por tmdbId/imdbId).
4. Status "nos cinemas"/futuro via Balloonerismm `/release_dates` (filmes sem streaming).
- **Enriquecimento**: JustWatch GraphQL não-oficial (canais), `provider-normalization`.
- **Cache**: `catalog_availability` com TTL próprio + estado negativo.
- **Risco**: **Balloonerismm é a fonte primária de disponibilidade**. Falha → serve
  cache/stale, nunca "Indisponível" falso (garantia explícita). Atribuição legal aponta
  para JustWatch.

### Acompanhando (`/api/poplog3/acompanhando`, `continuity/`)
- **Estado/progresso**: **DB** local (`user_title_state`, `episode_progress`).
- **Novos episódios**: continuity services + season cache (TVDB/Trakt/Balloonerismm via
  hydrator).
- **Risco**: baixo no runtime; depende da hidratação prévia de episódios (TVDB free tier
  250 req/mês é o gargalo real).

### Sorteio (`server/sorteio/sorteio-engine.ts`)
- **Pool discovery**: `catalogGetTrending` + `catalogGetPopular` (Trakt adapter) → **DB**.
- **Pool watchlist**: biblioteca do usuário (**DB**).
- **Availability**: `hydrateManyTitleAvailability` (camada global).
- **Risco**: não descarta títulos imdbId-only (Etapa 23). Depende de Trakt para pool
  discovery.

### Painel Admin / Debug (`src/app/admin/`, `/api/admin/`, `/api/debug/`)
- **Engine Logger**: `engine-logger` registra TODAS as chamadas (api, op, endpoint,
  cacheStatus, duração) → `TabApiHistory`, `EngineMonitorClient`.
- **Ferramentas**: hydrate-series-episodes, hydrate-library, availability-reset,
  radar-cache-flush, consolidate-synthetic-ids, trakt-cache-reset, dev/trakt-test.
- **Health/config**: `/api/debug/health`, `/api/debug/config` (exibe flags ativas).
- **Risco**: ferramentas de hidratação em massa podem estourar quotas (TVDB/Trakt).

---

## 3. Balloonerismm — uso detalhado

### 3.1 Endpoints efetivamente chamados
(de `grep balloonerismGet` + `balloonerismm-adapter.ts` + `balloonerismm-providers.ts`)

| Endpoint | Onde | Função | TTL |
|----------|------|--------|-----|
| `/movie/{id}` | adapter `getMovie` | detalhes de filme (pt-BR) | 7d |
| `/tv/{id}` | adapter `getShow` | detalhes de série (pt-BR) | 24h |
| `/tv/{id}/season/{n}` | adapter (season/episodes) | temporadas/episódios (fallback) | 24h |
| `/search/multi` | adapter `searchTitles` | busca de títulos (primário) | 1h |
| `/search/person` | adapter `searchPeople` | busca de pessoas | 1h |
| `/search/company` | adapter `searchCompanies` | busca de empresas | 1h |
| `/person/{id}` | `searchEntities`, `getPersonPageData` | perfil de pessoa | 24h |
| `/person/{id}/combined_credits` | `getPersonPageData` | créditos da pessoa | 24h |
| `/{type}/{id}/recommendations` | balloon-engine | recomendações (Para Você + Título) | 24h |
| `/{type}/{id}/similar` | balloon-engine | similares | 24h |
| `/trending/*` | adapter `getTrending` | trending (secundário a Trakt Index) | 1h |
| `/popular` ou equivalente | adapter `getPopular` | popular | 6h |
| `/discover` (with_genres) | adapter `getByGenre` | discover por gênero | 2h |
| `/{type}/{id}/ratings` | adapter `getRatings` | rating/votos | 1h |
| `/{type}/{id}/credits` | adapter `getPeople` | elenco/equipe | 30d |
| `/{type}/{id}/videos` | adapter `getVideos` | trailers | 6h |
| `/watch/providers` | `balloonerismm-providers.ts` | disponibilidade (primário) | PROVIDERS_TTL |
| `/release_dates` | `release-status.ts` | status de lançamento | RELEASE_DATES_TTL |

### 3.2 Onde Balloonerismm é **indispensável** (sem substituto direto hoje)
- **Detalhes de títulos Balloonerismm-only** (synthetic id negativo derivado de imdbId).
- **Busca de pessoas e empresas** (Trakt não cobre).
- **Páginas de pessoa** (`/person/[id]`, créditos combinados).
- **Disponibilidade / Onde Assistir** (fonte primária global de providers).
- **Ranking de recomendações** (Para Você + bloco de Título): é a fonte de relevância.

### 3.3 Onde Balloonerismm pode gerar lentidão / duplicidade
- **Para Você**: até 12 seeds × 2 endpoints (`/recommendations` + `/similar`) = ~24
  chamadas por refresh. Já mitigado (in-flight dedup, cooldown por path, pool cache),
  mas é o ponto mais pesado.
- **Página de Título**: pode coexistir com Trakt+TVDB+OMDb+Wikidata numa mesma render.
- **Trending/Popular/Discover**: hoje Trakt Index é primário, então as variantes
  Balloonerismm desses endpoints são redundantes em produção (flags `*_ENABLED=false`
  no exemplo) — **candidatas a remoção/consolidação**.

### 3.4 O que poderia ser substituído / complementado
| Uso atual (Balloonerismm) | Alternativa viável | Observação |
|---------------------------|--------------------|------------|
| Trending / Popular / Discover | **Trakt Index (já primário)** | variantes Balloon redundantes — consolidar |
| Ratings (`/ratings`) | **OMDb** (já usado) + Trakt | `BALLOONERISMM_RATINGS_ENABLED=false` no exemplo |
| Financeiro parcial | **Wikidata → Wikipedia** (já fallback) | manter Balloon só como atalho |
| Episódios (fallback) | **TVDB + Trakt (já primários no merge)** | Balloon é 3º — pode virar opcional |
| Metadata de títulos já no catálogo | **DB local** (POPLOG-first) | aumentar TTL / pré-hidratação |
| Créditos/elenco | Trakt people + DB | reduz chamadas live na página de título |

---

## 4. Riscos transversais e pontos de atenção

1. **Atribuição stale** — `src/attribution/api-sources.ts` e
   `src/server/strategies/api-priority.ts` ainda descrevem TMDB/Watchmode/MotN como
   ativos. Divergem do código real (POPLOG-first, TMDB removido). Devem ser atualizados
   ou removidos para o mapa não mentir.
2. **TVDB free tier (250 req/mês)** — gargalo real de hidratação de episódios. Único
   ponto com quota dura mensal.
3. **Fan-out da página de título** — até 5–7 APIs por render. DB-first reduz, mas é o
   maior risco de latência percebida.
4. **Para Você** — maior volume de chamadas Balloonerismm; sensível a cooldown/rate-limit.
5. **Dependência única por área** — Radar 100% Trakt, Providers 100% Balloonerismm,
   Busca de pessoas 100% Balloonerismm. Sem redundância nesses três.
6. **Flags divergentes** — `.env.example` mostra Balloonerismm `*_ENABLED=false` e
   `CATALOG_SOURCE=legacy`, enquanto a operação real (memória do projeto) é
   Balloonerismm-primary. O estado verdadeiro vive no `.env.local`, não versionado —
   conferir antes de qualquer decisão.

---

## 5. Próximos passos sugeridos (não executados)
- Atualizar/remover `attribution/api-sources.ts` e `strategies/api-priority.ts` (stale).
- Consolidar trending/popular/discover numa única fonte (Trakt Index) e remover as
  variantes Balloonerismm redundantes.
- Confirmar flags reais do `.env.local` para validar este mapa contra produção.
- Considerar pré-hidratação (worker) dos seeds de "Para Você" para reduzir chamadas live.
