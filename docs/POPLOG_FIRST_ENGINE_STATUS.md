# POPLOG-first Engine — Status de Estabilização

**Branch:** `feature/balloonerismm-api-migration`  
**Data:** 2026-06-04  
**Versão:** Etapas 1–30 concluídas

---

## 1. Estado geral

O sistema está **pronto para continuar em modo local estável**. Todos os checks técnicos passam e os fluxos principais foram validados ponta a ponta para quatro casos de título: filme com TMDB real, filme IMDb-first com ID sintético negativo, série com TMDB real e série IMDb-first/Balloonerismm-first.

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ 0 erros |
| `npm run lint` | ✅ 0 erros, 180 warnings pré-existentes |
| `npm run db:smoke:local-full` | ✅ 44 passed, 0 failed |
| `npm run build` | ✅ Completo sem erros |

---

## 2. Arquitetura de identidade

### 2.1 Hierarquia de identificadores

O sistema usa quatro tipos de identificador para um título, em ordem de precedência:

| Identificador | Tipo | Descrição |
|---|---|---|
| `poplogId` | `string` | ID interno do catálogo POPLOG (`poplog3Title.id`). Fonte primária de identidade quando disponível. |
| `imdbId` | `string` (`tt\d+`) | ID IMDb. Fonte primária para títulos Balloonerismm-first. Usado para links canônicos. |
| `tmdbId` real | `number > 0` | ID TMDB positivo. Alias legado — ainda presente em DB e caches para títulos com mapeamento TMDB. |
| `tmdbId` sintético | `number < 0` | Derivado de `imdbId` via `syntheticTmdbFromImdbId("tt0137523") = -137523`. Usado como chave de user state para títulos sem mapeamento TMDB real. |

### 2.2 Geração de ID sintético

```ts
// lib/ids/synthetic-tmdb-id.ts
syntheticTmdbFromImdbId("tt0137523") → -137523   // Fight Club
syntheticTmdbFromImdbId("tt1375666") → -1375666  // Inception
imdbIdFromSyntheticTmdbId(-137523)   → "tt0137523"
isSyntheticTmdbId(-137523)           → true
```

IDs sintéticos são armazenados em:
- `user_title` (watchlist/favoritos/status)
- `user_title_state` (estado computado/progresso)
- `poplog3Title` (cache de metadados — negativo é válido no `INT` MySQL)

### 2.3 Resolução de identidade

O fluxo de resolução em `poplog-title-identity.ts`:

```
ID recebido (URL/API)
    │
    ├─ String negativa (ex: "-137523") → imdbIdFromSyntheticTmdbId → "tt0137523" → resolve via imdbId
    ├─ String "tt\d+" (imdbId) → findByExternalId → poplog3Title (se existir) → enrich via Balloonerismm
    ├─ String positiva numérica → findByTmdbId (tmdbId real)
    ├─ UUID/string → findByPoplogId
    └─ Slug → findByTitleYear
```

O user state identity resolver (`poplog-user-state-identity.ts`) aceita todos esses formatos e sempre resolve para um `tmdbId` (real positivo ou sintético negativo) para persistência.

### 2.4 `linkIdUsed` — ID canônico para URLs

Para links de navegação, usa-se `linkIdUsed` em vez do `tmdbId` bruto:

```
linkIdUsed = poplogId ?? imdbId ?? balloonerismmId ?? slug ?? tmdbId
```

Isso garante URLs limpas como `/title/movie/tt0137523` para títulos IMDb-first, evitando `/title/movie/-137523`.

---

## 3. Fontes de dados e seus papéis

| Fonte | Dados fornecidos | Modo de acesso | Cache |
|---|---|---|---|
| **Balloonerismm** | Título, overview, imagens, cast, ratings básicos, orçamento/bilheteria, Metacritic | `catalogGetMovie` / `catalogGetShow` via `getPoplogTitleDetails` | `poplog3Title` (sintético ou poplogId) |
| **OMDb** | IMDb rating, IMDb votes, Rotten Tomatoes, Metacritic | `syncOmdbRatings` | `TitleRating` (cache por tmdbId/sintético) |
| **TVDB** | Temporadas, episódios, stills | `tvdbAdapter` via `/api/poplog3/tv/[id]/seasons/[season]` | `title_seasons`, `title_episodes` |
| **DB local `poplog3Title`** | Cache de metadados de qualquer fonte | `getCachedTitleRow` / `getLocalTitlesBatch` | É o cache; TTL 7 dias para títulos reais |
| **`user_title_state`** | Estado computado do usuário (progresso, watchlist, favoritos) | `readTitleState`, `getLocalContinuityStateRows` | Materializado — fonte de verdade da UI |

### 3.1 Fluxo de cache para títulos sintéticos

```
Visita à página de título IMDb-first
    └─ getPoplogTitleDetails → Balloonerismm fetch
        └─ [write-through] upsertCachedTitleRow(tmdbId=-137523)

Abertura da biblioteca
    └─ enrichLibraryItem(tmdbId=-137523)
        ├─ getCachedTitleRow → hit (se visitado antes) ✓
        └─ getCachedTitleRow → miss → fetchAndCacheSyntheticTitle → Balloonerismm → cache ✓

Endpoints de Acompanhando (continue, watchlist-picks, new-episodes, recently-watched)
    └─ getLocalTitlesBatch(tmdbIds)
        └─ missingIds filter → enrichSyntheticTitlesBatch → Balloonerismm → cache ✓
```

Segunda carga sempre é cache-hit no DB local. Sem chamadas Balloonerismm repetidas.

---

## 4. Helper de imagens: `resolveCatalogImage`

```ts
// lib/images/resolve.ts
resolveCatalogImage(src, size?)
```

- **URL completa** (`https://...`) → passthrough sem modificação
- **Path TMDB legado** (`/abc.jpg`) → `https://image.tmdb.org/t/p/{size}/abc.jpg`
- **null / undefined / string vazia** → `null`

**Usar sempre** nos componentes UI em vez de `buildTmdbRawUrl` direto. Correto para imagens Balloonerismm, TMDB e qualquer CDN futuro.

---

## 5. Blocos estabilizados

### 5.1 Catálogo e navegação

| Bloco | Status | Notas |
|---|---|---|
| **Home / Hero** | ✅ | Trending via Balloonerismm + fallback local-DB; `linkIdUsed` correto nos cards |
| **Trending / Discovery** | ✅ | Fallback local-DB quando Balloonerismm inativo; `linkIdUsed` em FilterChips |
| **Busca** | ✅ | `titleLinkId = linkIdUsed ?? poplogId ?? imdbId ?? tmdb_id` |
| **Sorteio** | ✅ | `SorteioItem.id` pode ser sintético negativo; navegação e watchlist corretos |
| **Agenda / Radar** | ✅ | `resolveCatalogImage` em `TMDB_IMG` alias; enrichment local-DB em buildAgendaPayload |

### 5.2 Página de título

| Sub-bloco | Status | Notas |
|---|---|---|
| Metadados básicos | ✅ | Título, overview, year, genres, runtime via Balloonerismm |
| Imagens | ✅ | posterUrl/backdropUrl via `buildTmdbRawUrl` (passthrough para URLs completas) |
| Providers / Disponibilidade | ✅ | Via watchmode/MOTN cache local; `resolveCatalogImage` para logos |
| Trailer | ✅ | Link externo IMDb (iframe desabilitado para non-YouTube); thumbnailUrl incluída |
| Orçamento / Bilheteria | ✅ | Balloonerismm (budget, revenue, domesticGross, Metacritic) |
| Ratings externos | ✅ | OMDb sync: IMDb, Rotten Tomatoes, Metacritic; TMDB rating via Balloonerismm |
| Rating pessoal (UserRating) | ✅ | Aceita `tmdbId` real ou sintético negativo; imdbId como fallback |
| Community rating | ✅ | Via `getPublicRating(ratingKeyId)` — suporta IDs sintéticos |
| Temporadas / Episode browser | ✅ | Habilitado apenas para séries com tmdbId real (dados TVDB no DB) |
| Elenco / Ficha técnica | ✅ | Balloonerismm cast/crew; metadata block com diretores, roteiristas, compositores |
| Recomendações | ✅ | Via `catalogGetRelated` (imdbId-first) → Balloonerismm |
| User state (watchlist/fav) | ✅ | `TitleActions` usa `toAnyTmdbId` (aceita negativos); `identityPayload` correto |

### 5.3 Biblioteca e user state

| Bloco | Status | Notas |
|---|---|---|
| Library page — cards TMDB real | ✅ | `getCachedTitleRow` → título, imagem, link `/title/movie/550` |
| Library page — cards IMDb-first | ✅ | `fetchAndCacheSyntheticTitle` → Balloonerismm → cache; link `/title/movie/tt0137523` |
| Watchlist / Favoritos | ✅ | `upsertUserTitleStatus` + `upsertUserTitleState` via synthetic tmdbId |
| Ratings pessoais | ✅ | `upsertUserRating` via `resolveUserStateIdentity`; suporta sintéticos |
| Provider logos na biblioteca | ✅ | `resolveCatalogImage(item.best_provider_logo, "original")` |
| Links dos cards | ✅ | `item.imdb_id ?? item.tmdb_id` — evita URL negativa quando possível |
| LibraryHero | ✅ | `TmdbImageLegacy` com passthrough de URLs completas |

### 5.4 Acompanhando / Continue Watching

| Rota | Status | Notas |
|---|---|---|
| `/api/poplog3/continuity/continue` | ✅ | `enrichSyntheticTitlesBatch` para IDs faltantes |
| `/api/poplog3/continuity/new-episodes` | ✅ | idem |
| `/api/poplog3/continuity/watchlist-picks` | ✅ | idem (separado por media_type) |
| `/api/poplog3/continuity/recently-watched` | ✅ | idem — corrigido na etapa final |
| `/api/poplog3/continuity/hero` | ✅ | Candidatos via `user_title_state`; `getTmdbId` preserva sinal negativo |
| Cards visuais | ✅ | `resolveCatalogImage` em ContinueCard, NewEpisodeCard, WatchlistPickCard, etc. |
| Curadoria signals | ✅ | Regex `(-?\d+)` aceita IDs negativos em sinais hero |

### 5.5 Outros

| Bloco | Status | Notas |
|---|---|---|
| Perfil | ✅ | `getLogoUrl` via `resolveCatalogImage` (sem hardcode `image.tmdb.org`) |
| Unauthenticated | ✅ | TitleActions mostra "Entre para salvar"; rotas retornam 401 sem user |
| Sorteio | ✅ | IDs sintéticos em `SorteioItem.id`; link e watchlist resolvem corretamente |

---

## 6. Limitações conhecidas

### 6.1 Funcionais (não bloqueantes)

| Limitação | Severidade | Motivo | Solução futura |
|---|---|---|---|
| **Episode browser desabilitado para séries sintéticas** | Baixa | Sem dados de temporada/episódio no DB local para séries sem mapeamento TMDB | Sincronizar via TVDB por imdbId quando disponível |
| **Alguns cards de Acompanhando usam URL negativa** | Cosmética | Cards de Continue/RecentlyWatched usam `item.tmdb_id` diretamente | Adicionar `imdb_id` nos tipos dos itens |
| **Cache write-through usa `void`** | Baixa | Em serverless, a escrita pode ser cortada. Na próxima carga de biblioteca, `enrichLibraryItem` re-faz o fetch | Aguardar com timeout curto, ou persistir em background worker |
| **`TitleCommunityHighlights` oculto para filmes IMDb-first** | Baixa/Intencional | Highlights de comunidade dependem de dados TMDB (reviews, comentários) | Aguardar expansão do catálogo local |

### 6.2 Técnicas (refactor futuro)

| Item | Tipo | Impacto |
|---|---|---|
| `TmdbImageLegacy` em ~20 arquivos | Refactor cosmético | Funciona corretamente (passthrough de URLs), mas nome é enganoso |
| `tmdb_id` como nome de coluna no schema | Schema legado | Sem impacto funcional; renomear para `catalog_id` requer migração DB |
| `lib/tmdb-utils.ts` (getTitle, getRating etc.) | Renomear | Funções genéricas com nome TMDB; sem impacto funcional |
| Labels "via TMDB" em `UserRatingWidget` | Rebranding | Referência técnica correta; pode ser "via POPLOG" futuramente |
| `buildTmdbRawUrl` em código server-side | Alias aceitável | Já faz passthrough de URLs completas; `resolveCatalogImage` é o padrão novo |

---

## 7. Mapa de arquivos críticos

### 7.1 Identidade e resolução

```
src/lib/ids/synthetic-tmdb-id.ts          — geração e detecção de IDs sintéticos
src/server/titles/poplog-title-identity.ts — resolução de qualquer ID para identity
src/server/user-state/poplog-user-state-identity.ts — resolução para user state
src/server/titles/poplog-title-details.ts  — fetch de detalhes via Balloonerismm/local
src/server/titles/get-title-page-data.ts   — montagem do TitlePageData + write-through cache
```

### 7.2 Cache de metadados

```
src/server/repositories/title-cache.repository.ts  — upsertCachedTitleRow (aceita negativos + URLs completas)
src/server/local-services/library-local.service.ts — enrichLibraryItem + fetchAndCacheSyntheticTitle
src/server/local-services/continuity-local.service.ts — getLocalTitlesBatch + enrichSyntheticTitlesBatch
```

### 7.3 Imagens

```
src/lib/images/resolve.ts       — resolveCatalogImage (canônico)
src/components/images/CatalogImage.tsx — componente padrão novo
src/components/images/TmdbImage.tsx    — TmdbImageLegacy (compatibilidade)
src/lib/images/url.ts           — buildTmdbRawUrl / buildTmdbUrlLoose (server-side)
```

### 7.4 Rotas de user state

```
src/app/api/library/title/route.ts              — GET/POST/PATCH/DELETE watchlist/status
src/app/api/ratings/route.ts                    — GET/POST/DELETE ratings pessoais
src/app/api/poplog3/episodes/route.ts           — progresso de episódios
src/app/api/poplog3/continuity/continue/route.ts
src/app/api/poplog3/continuity/recently-watched/route.ts
src/app/api/poplog3/continuity/watchlist-picks/route.ts
src/app/api/poplog3/continuity/new-episodes/route.ts
```

---

## 8. Próximos passos recomendados

### 8.1 Imediatos (antes de avançar)

- [ ] **Checkpoint Git**: criar commit de estabilização com tag ou branch de backup antes de continuar o desenvolvimento
- [ ] **Testar com usuário autenticado real**: validar ciclo completo — abrir título IMDb-first → adicionar watchlist → ver na biblioteca → Acompanhando — com usuário real em ambiente local

### 8.2 Curto prazo

- [ ] **Documentar variáveis de ambiente locais**: consolidar `.env.local` necessário para `BALLOONERISMM_*`, `OMDB_API_KEY`, `TVDB_*` em `docs/LOCAL_FULL_MODE.md`
- [ ] **Adicionar `imdb_id` aos tipos de cards de Acompanhando**: permitir links limpos `tt...` em ContinueItem, WatchlistPickItem, RecentlyWatchedItem
- [ ] **Verificar `enrichSyntheticTitlesBatch` em produção**: confirmar que o cache write para IDs sintéticos persiste corretamente no Postgres de produção

### 8.3 Médio prazo

- [ ] **Expandir catálogo local**: sincronizar mais títulos populares IMDb-first para `poplog3Title`, reduzindo dependência do Balloonerismm em cold start
- [ ] **Migrar `TmdbImageLegacy` → `CatalogImage`**: refactor cosmético nos ~20 arquivos restantes
- [ ] **Sincronização de temporadas via TVDB por imdbId**: habilitar episode browser para séries IMDb-first com mapeamento TVDB disponível

### 8.4 Longo prazo (requer migração de schema)

- [ ] **Renomear `tmdb_id` → `catalog_id`** em `Poplog3Title`, `UserTitle`, `UserTitleState` e tabelas relacionadas
- [ ] **Rebranding de labels TMDB**: `"via TMDB"` → `"via POPLOG"` ou `"externas"` em UserRatingWidget
- [ ] **Consolidar `lib/tmdb-utils.ts` → `catalog-utils.ts`**

---

## 9. Configuração de feature flags relevantes

```bash
# Balloonerismm como fonte primária
BALLOONERISMM_ACTIVE=true
BALLOONERISMM_SEARCH_ENABLED=true
BALLOONERISMM_TRENDING_ENABLED=true
BALLOONERISMM_DISCOVER_ENABLED=true

# Ratings externos via OMDb
OMDB_API_KEY=...

# Local DB (sem Supabase)
LOCAL_AUTH=true
LOCAL_FULL_MODE=true
```

---

## 10. Referência rápida de casos de título

| Caso | URL de exemplo | ID na DB | User state key | Image source |
|---|---|---|---|---|
| Filme TMDB real | `/title/movie/550` | tmdbId=550 | tmdbId=550 | TMDB path |
| Filme IMDb-first | `/title/movie/tt0137523` | tmdbId=-137523 | tmdbId=-137523 | Balloonerismm URL |
| Série TMDB real | `/title/tv/1396` | tmdbId=1396 | tmdbId=1396 | TMDB path |
| Série IMDb-first | `/title/tv/tt0903747` | tmdbId=-903747 | tmdbId=-903747 | Balloonerismm URL |
| Título por poplogId | `/title/movie/clx...` | id=clx... | resolvido p/ tmdbId | local DB |

---

*Documento gerado em 2026-06-04. Para histórico completo das etapas 1–30, consultar os arquivos de memória em `.claude/projects/*/memory/`.*
