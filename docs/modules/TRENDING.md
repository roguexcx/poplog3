# Investigação Técnica — Módulo Trending / "Em Alta Agora" (POPLOG)

> Documento de diagnóstico. Mapeia origem → exibição, lista APIs/arquivos, descreve o
> comportamento real observado no código e lista problemas, riscos e checklist de validação.
> Branch analisada: `feature/sistema-novo`. Data: 2026-06-26.
>
> **Revisão 2026-06-26.** O search/discovery agora é bare `/api/search/discovery`
> (o legado `/api/poplog3/*` foi removido). Canônico em `../POPLOG_SYSTEM_OVERVIEW.md`.
>
> **STATUS: os problemas P1–P5 e o bug de idioma foram corrigidos na Etapa Trending V2.
> Ver a seção 10 (Resolução) ao final para o novo fluxo, contrato V2, chaves de cache,
> TTLs, regras de recência e validações executadas.**

---

## 1. Visão geral do estado atual

O trending do POPLOG tem **uma fonte de verdade canônica** declarada — o pipeline
`getTrendingFeed()` em [`src/features/home/trending-feed.ts`](../src/features/home/trending-feed.ts) —
consumido tanto pelo bloco "Em alta agora" quanto pelo Hero rotativo da Home. A intenção de
design (documentada no topo do arquivo) é boa: mesma base, mesmas exclusões, mesmo scoring.

A **origem real dos dados** é o **Trakt**, em duas formas:

1. **Trakt Index** (primário) — engine própria de scoring com **7 sinais públicos** da Trakt
   (`trending`, `watched`, `played`, `favorited` para filmes/séries), combinados numa fórmula
   de ranking. Código em [`src/lib/trakt-index/engine.ts`](../src/lib/trakt-index/engine.ts),
   orquestrado por [`src/lib/trakt-index/canonical.ts`](../src/lib/trakt-index/canonical.ts).
2. **Trakt adapter** (`/movies/trending` + `/shows/trending`) — fallback mais simples quando o
   Index falha/é insuficiente.
3. **DB local** (`poplog3Title` ordenado por `popularity desc`) — último fallback.

**Não há mais dependência de TMDB** no trending (migração concluída em etapas anteriores). As
imagens vêm dos campos `images` da própria Trakt (`poster`/`fanart`/`thumb`).

**Estado:** funcional, mas com **divergências de cache e de hidratação** que fazem a Home
oscilar entre "trending real" e "popularidade do DB local", além de uma **lacuna de POPLOG_ID**
nos itens de trending. Detalhes nas seções 6 e 7.

---

## 2. Fluxo completo mapeado

### 2.1 Caminho de origem (server)

```
                       ┌─────────────────────────────────────────────┐
                       │  getTrendingFeed(options)   (trending-feed.ts)│
                       │  região=BR  idioma=pt-BR  (default)           │
                       └─────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        │ 1. CACHE de continuidade        │                                   │
        │    sectionKey =                 ▼                                   │
        │    includeProviders ? "home_trending" : "home_trending_light"      │
        │    (Redis → DB local; por região+idioma)                           │
        └─────────────────────────────────┬──────────────────────────────────┘
                   hit/stale → retorna     │ miss
                                           ▼
                              ┌───────────────────────┐
                    fast=true │  options.fast ?        │ fast=false
              ┌───────────────┴───────────────┐       └──────────────┐
              ▼                                                       ▼
    ┌──────────────────┐                              ┌───────────────────────────────┐
    │ fetchLocalTrending│                              │ 2. TRAKT INDEX (primário)     │
    │ (DB popularity)   │                              │ getPoplogDailyTrendingIndex() │
    │ grava light cache │                              │ ≥5 itens → grava cache, retorna│
    │ (TTL 10min)       │                              └──────────────┬────────────────┘
    │ agenda refresh BG │                                             │ vazio/erro/<5
    └──────────────────┘                                             ▼
              │                                          ┌───────────────────────────────┐
              │ (background)                              │ 3. TRAKT adapter trending     │
              └──── scheduleTrendingRefresh ──────────►   │ catalogGetTrending movie+show │
                    (fast:false, skipCache:true)          │ interleave, hidrata, ≥5 → cache│
                                                          └──────────────┬────────────────┘
                                                                         │ vazio/erro/<5
                                                                         ▼
                                                          ┌───────────────────────────────┐
                                                          │ 4. DB LOCAL (fallback final)  │
                                                          │ fetchLocalTrending popularity │
                                                          └───────────────────────────────┘
```

### 2.2 Enriquecimento comum (`enrichWithRuntime`)

Toda lista, independentemente da fonte, passa por `enrichWithRuntime`:
- resolve `runtime_label` (filme) / label de episódio (série), com `getSeriesEpisodeRuntimesMap`;
- resolve identidade (`resolveCatalogIdentityFields`) — **exceto itens `trakt_index`, que NÃO
  são re-resolvidos** (mantêm o identity do Index);
- anexa disponibilidade (`attachBestProvider`) por região, **somente quando
  `includeProviders !== false`**.

### 2.3 Caminho de exibição (client)

| Superfície | Entrada | Como chama |
|---|---|---|
| **Hero rotativo** | [`HomePage.tsx`](../src/features/home/HomePage.tsx) (server component) | `getTrending(userId, { fast:true, includeProviders:false })` → `getTrendingFeed`. Filtra candidatos com backdrop+poster+overview+`vote_average>=6.5`, sorteia 1 (rotação a cada F5). |
| **Bloco "Em alta agora"** | [`TrendingNowSection.tsx`](../src/features/home/components/TrendingNowSection.tsx) (client) | `fetch('/api/trending?includeProviders=0&fast=1&language=&region=')` → rota → `getTrendingFeed`. |
| **Search / Discovery** | [`/api/search/discovery/route.ts`](../src/app/api/search/discovery/route.ts) | `getPoplogDailyTrendingIndex()` **diretamente** (não passa por `getTrendingFeed`). |

---

## 3. APIs externas

### 3.1 Trakt — Trakt Index (7 sinais)
Arquivo: [`src/lib/trakt-index/engine.ts`](../src/lib/trakt-index/engine.ts) · cliente `traktGet`.

| Sinal | Endpoint | Período | Peso | Métrica |
|---|---|---|---|---|
| movies_trending | `/movies/trending` | não | 2.20 | watchers |
| movies_watched | `/movies/watched/{period}` | sim | 1.35 | watcher_count |
| movies_played | `/movies/played/{period}` | sim | 1.15 | play_count |
| movies_favorited | `/movies/favorited/{period}` | sim | 0.55 | user_count |
| shows_trending | `/shows/trending` | não | 2.20 | watchers |
| shows_watched | `/shows/watched/{period}` | sim | 1.35 | watcher_count |
| shows_favorited | `/shows/favorited/{period}` | sim | 0.50 | user_count |

- **Parâmetros:** `extended=full,images`, `page=1`, `limit=50`. `{period}` = `daily` (fixo na chamada canônica).
- **Idioma/região:** as chamadas de sinal **não** enviam idioma/região (dados globais). A
  tradução pt-BR vem de uma chamada **separada** `/{movies|shows}/{slug|trakt}/translations/pt`
  (limite `translationLimit=24` primeiros itens), aplicada sobre `title/overview/tagline`,
  preservando `original_title`.
- **Erro:** `Promise.allSettled` por sinal; sinal que falha é logado e ignorado. Se todos
  falharem → `[]`.
- **Frequência:** TTL HTTP 1800s (30min) por chamada; resultado do índice cacheado 30min
  (seção 5).

### 3.2 Trakt — adapter trending (fallback)
Arquivo: [`src/server/source-engine/adapters/trakt-adapter.ts:380`](../src/server/source-engine/adapters/trakt-adapter.ts).
- Endpoints `/movies/trending` e `/shows/trending`, `limit` (default 20),
  `extended=full,images[,translations]` quando `shouldUsePtBrTranslations(language)`.
- TTL HTTP 3600s. Normaliza para `CatalogSearchResult` e depois hidrata via
  `hydrateCatalogResultsWithDebug`.

### 3.3 Sem TMDB
Confirmado: nenhuma chamada TMDB no pipeline de trending. `TmdbImage`/`buildTmdbUrlLoose` são
apenas wrappers de renderização sobre URLs já resolvidas (a nomenclatura "Tmdb" é legada).

---

## 4. APIs internas e arquivos

### Pipeline canônico
- [`src/features/home/trending-feed.ts`](../src/features/home/trending-feed.ts) — **fonte de verdade**. `getTrendingFeed`, `fetchLocalTrending`, `enrichWithRuntime`, `interleaveTrending`, `scheduleTrendingRefresh`, constantes de TTL/limites.
- [`src/lib/trakt-index/canonical.ts`](../src/lib/trakt-index/canonical.ts) — `getPoplogDailyTrendingIndex`, versão do algoritmo (`POPLOG_TRENDING_ALGORITHM_VERSION = "trakt-7-signals-daily-v2"`), chaves de cache, `resetPoplogTrendingCaches`.
- [`src/lib/trakt-index/engine.ts`](../src/lib/trakt-index/engine.ts) — `buildTraktIndex`, scoring, dedup/merge, interleave, tradução, `isTraktIndexEnabled`.
- [`src/lib/trakt-index/types.ts`](../src/lib/trakt-index/types.ts) — `TraktIndexItem` e correlatos.

### Rotas
- [`src/app/api/trending/route.ts`](../src/app/api/trending/route.ts) — `GET /api/trending`. Resolve feedback do usuário (timeout 500ms), chama `getTrendingFeed`, aplica `applyUserFeedbackScoring(context:"trending")`.
- [`src/app/api/search/discovery/route.ts`](../src/app/api/search/discovery/route.ts) — usa `getPoplogDailyTrendingIndex` direto (caminho paralelo).
- [`src/app/api/trakt-index/route.ts`](../src/app/api/trakt-index/route.ts) — expõe o índice cru (debug/admin).
- [`src/app/api/trakt-cache-reset/route.ts`](../src/app/api/trakt-cache-reset/route.ts) — `POST` reset de caches de trending (protegido por `TRAKT_CACHE_RESET_SECRET`).

### Cache
- [`src/server/continuity/continuity-section-cache.ts`](../src/server/continuity/continuity-section-cache.ts) — camada Redis→DB local; chave inclui `userId/region/language`. **Usada por `trending-feed.ts`.**
- [`src/server/local-services/continuity-section-cache-local.service.ts`](../src/server/local-services/continuity-section-cache-local.service.ts) — wrapper sobre repositórios (DB local). **Usada por `canonical.ts`.**
- [`src/server/repositories`](../src/server/repositories) — persistência efetiva.

### Hidratação / identidade / disponibilidade
- `src/server/source-engine/hydrate-catalog-results.ts` — `hydrateCatalogResultsWithDebug`, `resolveCatalogIdentityFields`.
- [`src/server/availability/attach-best-provider.ts`](../src/server/availability/attach-best-provider.ts) — `best_provider_*` (badge "onde assistir").
- `src/server/utils/filter-valid-titles.ts` — `filterValidTitles`.
- [`src/lib/content-format/excluded-formats.ts`](../src/lib/content-format/excluded-formats.ts) — `isExcludedFormat` (censura talk show/variedades/reality).

### Locale / scoring
- [`src/server/source-engine/locale.ts`](../src/server/source-engine/locale.ts) — `normalizeCatalogLanguage/Region`, `resolveLocaleScope`. Suportados: idiomas `pt-BR`/`en-US`; regiões `BR`/`US`.
- `src/lib/personalization/scoring.ts` — `applyUserFeedbackScoring`. `feedback.ts` — `getUserFeedbackMap`.

### UI
- [`HomePage.tsx`](../src/features/home/HomePage.tsx), [`home-api.ts`](../src/features/home/home-api.ts), [`HeroSection.tsx`](../src/features/home/components/HeroSection.tsx), [`TrendingNowSection.tsx`](../src/features/home/components/TrendingNowSection.tsx).

### Modelo Prisma
- `poplog3Title` — usado em `fetchLocalTrending` e `localPopularQuery`. Campos lidos: `id (poplogId)`, `tmdbId`, `mediaType`, `title`, `posterPath`, `popularity`, `imdbId`, etc. Filtro `posterPath != null`, ordem `popularity desc`.

### Variáveis de ambiente
- `TRAKT_INDEX_ENABLED` / `TRAKT_ACTIVE` — habilita o Index (`"false"`/`"0"` desabilita).
- `TRAKT_CLIENT_ID` — autenticação Trakt (cliente).
- `TRAKT_CACHE_RESET_SECRET` — protege o reset (ausente em dev = aceita sem secret).

### Constantes-chave (`trending-feed.ts`)
`TRENDING_CACHE_TTL_MS=30min`, `TRENDING_LIGHT_CACHE_TTL_MS=10min`, `TRENDING_DB_TIMEOUT_MS=1.5s`,
`TRAKT_INDEX_TIMEOUT_MS=14s`, `TRENDING_TRAKT_LIMIT=15`, `TRENDING_MIN_RESULTS=5`,
`TRENDING_LOCAL_FALLBACK_LIMIT=20`, região `BR`, idioma `pt-BR`.

---

## 5. Cache — chaves e TTLs

| Chave (sectionKey) | Quem grava | Quem lê | TTL | Resetado por `resetPoplogTrendingCaches`? |
|---|---|---|---|---|
| `trakt_index_top50_daily_trakt-7-signals-daily-v2` | `canonical.ts` | `canonical.ts` | 30min | **Sim** (chave versionada) |
| `trakt_index_top50_daily` (legada) | — | — | — | Sim (proativo) |
| `home_trending` (includeProviders=true) | `getTrendingFeed` | `getTrendingFeed` | 30min | Sim |
| **`home_trending_light`** (includeProviders=false) | `getTrendingFeed` | `getTrendingFeed` | 10min / 30min* | **NÃO** ⚠️ |

\* No caminho `fast`/local grava 10min; no caminho Trakt grava 30min (mesma chave, TTLs diferentes).

Chave de cache de continuidade é segmentada por `region` + `language` (e `userId`, aqui `anon`) →
**separação de idioma/região está correta** na camada de cache.

---

## 6. Comportamento real encontrado

1. **Ambas as superfícies da Home usam `home_trending_light`.** Hero (`includeProviders:false`)
   e bloco "Em alta" (`includeProviders=0`) → mesma chave `home_trending_light`. ✔ compartilham base.

2. **Em modo `fast`, o trending real (Trakt Index) NUNCA é calculado no caminho crítico.** O
   `fast` vai direto a cache → DB local (popularidade). O Trakt Index só entra via
   `scheduleTrendingRefresh` (background, `fast:false`). Logo, **no primeiro paint após cache
   expirado o usuário vê "popularidade do DB local", não trending real** — e só na navegação
   seguinte (após o refresh popular o cache) vê o ranking Trakt.

3. **Oscilação por TTLs concorrentes na mesma chave.** O caminho local grava `home_trending_light`
   com TTL 10min; o background refresh grava a mesma chave com TTL 30min. Dependendo de qual
   escreve por último, a Home alterna entre lista local e lista Trakt. Mistura de métricas
   (popularidade vs. trending) percebível pelo usuário.

4. **Itens de trending vindos do Trakt Index não têm POPLOG_ID.** `traktIndexToPoplogTitle`
   define `poplogId:null`, `hasPoplogId:false`, e `enrichWithRuntime` **não** re-resolve identidade
   para itens `trakt_index`. O link do card cai em `linkIdUsed ?? imdbId ?? id` (id sintético
   negativo). → **Não há normalização contra o banco**; ações de biblioteca/estado dependem de
   `useUserAction` resolver por `imdbId`/`tmdbId` em runtime.

5. **`tmdb_id` sintético negativo** é derivado de `trakt`/`imdb` quando não há TMDB
   (`syntheticTmdbId`), inclusive com offset `+10_000_000` para séries. Compatível com a
   "identidade sintética" do sistema, mas convive com IDs reais — risco de colisão/dedup
   already tratado em etapas anteriores, **a revalidar** no contexto trending.

6. **Região não filtra conteúdo.** Trakt trending/index são **globais**; `region` só afeta
   `attachBestProvider` (disponibilidade) e a chave de cache. "Em alta no BR" ≠ trending
   brasileiro — é trending global com disponibilidade BR.

7. **Idioma:** título/sinopse traduzidos via `/translations/pt` (Index) ou `extended=translations`
   (adapter). Só os **24 primeiros** itens do Index são traduzidos; itens 25–50 ficam no idioma
   original. `original_title` é preservado (correto para `LocalizedTitle`).

8. **Censura de formatos** aplicada em dois pontos (Index `buildTraktIndex` e `fetchLocalTrending`)
   via `isExcludedFormat`. ✔

9. **Discovery usa caminho paralelo** (`getPoplogDailyTrendingIndex` direto, sem `getTrendingFeed`)
   — não aplica `applyUserFeedbackScoring` nem `attachBestProvider`, e não compartilha o
   `home_trending*` cache. Possível divergência entre "trending na Home" e "trending no Search".

---

## 7. Problemas confirmados, hipóteses, riscos e lacunas

### Confirmados (lidos no código)
- **P1 — `home_trending_light` nunca é invalidado pelo reset.** `resetPoplogTrendingCaches`
  invalida `home_trending`, a chave versionada do Index e a legada, mas **não** `home_trending_light`,
  que é justamente a chave que a Home consome. Após bump de versão do algoritmo ou reset manual,
  a Home pode continuar servindo trending antigo por até 30min. → corrigir incluindo
  `home_trending_light` (e variações region/language) na lista de `keysToInvalidate`.
- **P2 — Trending real ausente no caminho `fast`.** Como ambas as superfícies usam `fast`, o
  ranking Trakt depende 100% do background refresh; cold start = popularidade local. Decidir se
  a Home deve esperar o Index (latência) ou exibir explicitamente "popular" como fallback rotulado.
- **P3 — Oscilação de TTL na mesma chave** (`home_trending_light` gravada com 10min OU 30min
  conforme a fonte). Padronizar TTL por chave ou separar chave local da chave trakt.
- **P4 — Itens de trending sem POPLOG_ID.** Quebra a aderência ao "POPLOG_ID canônico". Hidratar
  contra `poplog3Title` por `imdbId`/`tmdbId` no `enrichWithRuntime` (ou no `traktIndexToPoplogTitle`).
- **P5 — Discovery/Search fora do pipeline canônico.** Documentar como exceção intencional ou
  unificar via `getTrendingFeed`.

### Hipóteses (a validar em runtime)
- **H1** — Tradução parcial (apenas top 24) gera mistura visível pt/en na rolagem do bloco.
- **H2** — Itens sem `imdbId` no Index (só `trakt`/`slug`) podem não casar em
  `attachBestProvider`/`useUserAction`, resultando em card sem provider e sem ações.
- **H3** — Sob falha do Redis, leitura cai no DB local; sob falha de ambos, `getTrendingFeed`
  vai a Trakt — latência potencial de até `TRAKT_INDEX_TIMEOUT_MS=14s` em caminho não-`fast`.

### Riscos
- **R1** — Bump de `POPLOG_TRENDING_ALGORITHM_VERSION` sem corrigir P1 → "ninguém vê o novo
  algoritmo na Home" até `home_trending_light` expirar naturalmente.
- **R2** — IDs sintéticos negativos em conjunto com dedup de IDs (etapa 41) — revalidar que
  trending não cria/colide registros.
- **R3** — `Math.random()` em `syntheticTmdbId` (último fallback) gera IDs instáveis entre builds.

### Lacunas
- Sem testes automatizados específicos do pipeline trending (apenas smoke do client Trakt).
- Sem métrica/telemetria distinguindo "% de paints servidos de trending real vs. popularidade local".

---

## 8. Compatibilidade com o novo sistema POPLOG

| Critério | Situação |
|---|---|
| POPLOG_ID canônico | ⚠️ Itens de trending Trakt **não** carregam `poplogId` (P4). |
| Aliases (imdb/tmdb/trakt/slug) | ✔ `externalIds` preenchido a partir de `ids` do Trakt; `mergeIds` consolida. |
| Normalização no banco | ⚠️ Trending não é normalizado contra `poplog3Title` (só o fallback local é). |
| Cache por idioma/região | ✔ chave de continuidade inclui `region`+`language`+`userId`. |
| Serializers novos | ✔ `PoplogTitle`/`TMDBItem`; conversores `traktIndexToPoplogTitle`/`trendingTitleToTMDBItem`. |
| Hidratação multilíngue | ⚠️ Parcial — só top 24 traduzidos no Index. |
| Separação filme/série | ✔ interleave 1 filme / 1 série em ambos os níveis (engine e feed). |
| Deduplicação | ✔ no Index (`mergeIntoGroups` por imdb>tmdb>trakt>tvdb>slug>título+ano); ⚠️ revalidar com IDs sintéticos. |
| Redução de dependências legadas | ✔ TMDB removido; "Tmdb*" remanescente é só nomenclatura. |

---

## 9. Checklist do que precisa ser validado (runtime)

- [ ] Adicionar `home_trending_light` (com region/language) a `resetPoplogTrendingCaches` e
      confirmar que reset reflete na Home em < 1 request. **(P1)**
- [ ] Medir cold start: primeiro paint da Home após expirar cache → é trending Trakt ou
      popularidade local? Quantos requests até estabilizar? **(P2/P3)**
- [ ] Logar/contar `feed.source` por request em produção (`cache`/`trakt_index`/`trakt`/`local_db`)
      para quantificar quanto da Home é trending real.
- [ ] Verificar se cards de trending abrem a página correta e resolvem estado de biblioteca
      sem `poplogId` (clicar item só com `imdbId`/id sintético). **(P4/H2)**
- [ ] Inspecionar visualmente itens 25–50 do bloco quanto a título/sinopse em inglês. **(H1)**
- [ ] Confirmar paridade entre trending da Home e trending do Search/Discovery (mesma lista?). **(P5)**
- [ ] Confirmar que `attachBestProvider` retorna provider para itens só com `trakt`/`slug`. **(H2)**
- [ ] Testar `TRAKT_INDEX_ENABLED=false` → cai para adapter trending → DB local, sem quebrar UI.
- [ ] Revalidar dedup/colisão de IDs sintéticos negativos no contexto trending (etapa 41). **(R2/R3)**
- [ ] Conferir comportamento com `region=US`/`language=en-US`: cache separado e conteúdo coerente.

---

## 10. Resolução — Etapa Trending V2

Implementação que corrige o Trending para um bloco **vivo, localizado, confiável e
performático**, aderente à arquitetura POPLOG. Resumo do que mudou.

### 10.1 Novo fluxo (server)

`getTrendingFeed()` continua a fonte única, agora com **chaves de cache separadas por
fonte** e **realness explícito**:

```
read(home_trending[_light])  → hit/stale ? serve (realness=trending)
  miss:
   fast?  → PEEK índice Trakt bilíngue cacheado, projetado p/ idioma (sem rebuild)
              → ≥5 ? grava home_trending[_light] (30min) + serve (realness=trending)
            else read(home_trending_local[_light]) → hit ? serve (realness=fallback_local)
            else DB local → grava em home_trending_local[_light] (TTL 10min) + BG refresh
   !fast? → Trakt Index (projetado p/ idioma) → grava home_trending[_light] (TTL 30min)
            → Trakt adapter → grava home_trending[_light]
            → DB local → grava home_trending_local[_light] (TTL 10min)
```

> **Correção de idioma no caminho `fast`:** a Home/Hero/"Em alta agora" usam `fast=1`. Antes,
> esse caminho ia direto ao DB local (texto só pt-BR, sem `localized`), então em `en-US` o bloco
> aparecia em português. Agora o `fast` primeiro faz **peek** do índice Trakt bilíngue já cacheado
> (read-only, sem rebuild no caminho crítico) e projeta para `catalogLanguage` — `en-US` mostra
> inglês assim que o índice estiver quente (aquecido pelo background refresh / Discovery). O DB
> local pt-BR vira de fato o último recurso, só no cold start absoluto.

O **fallback local nunca é gravado na chave do trending real**, e todo retorno carrega
`realness: "trending" | "fallback_local"`, exposto no payload, nos logs e no `cacheStatus`.

### 10.2 Chaves de cache e TTLs (novo)

| Chave | Conteúdo | TTL | Reset oficial |
|---|---|---|---|
| `trakt_index_top50_daily_<versão>` (language=`bilingual`) | Índice **bilíngue** (fonte da verdade pt-BR+en-US) | 30min | ✔ |
| `home_trending` / `home_trending_light` | Trending **real** (por idioma/região) | 30min | ✔ (inclui `_light`) |
| `home_trending_local` / `home_trending_local_light` | **Fallback** local (popularidade) | 10min | ✔ |

`resetPoplogTrendingCaches` agora invalida as 6 chaves (versionada, legada, real, real-light,
local, local-light) **no MySQL E no Redis** (pattern delete por sectionKey, todas as variações
idioma/região) — corrige **P1**.

### 10.3 Idioma (bug corrigido)

- O índice virou **bilíngue**: cada item guarda `localized['pt-BR']` (tradução oficial Trakt) e
  `localized['en-US']` (original). Sem tradução manual — só armazenamento/normalização.
- `getPoplogDailyTrendingIndex({ language })` **projeta** `title/overview/tagline` para o idioma
  pedido na leitura; `original_title` permanece o original. Um único cache bilíngue serve os dois
  idiomas **sem contaminação** (a projeção é determinística por idioma).
- O cache do feed (`home_trending*`) é por idioma/região — payload de `pt-BR` não é reusado em
  `en-US`. Helper reutilizável: [`src/lib/i18n/catalog-localization.ts`](../src/lib/i18n/catalog-localization.ts)
  (`pickLocalized`, `computeCatalogLanguageStats`) — desenhado para adoção site-wide.
- Search/Discovery passou a passar `catalogLanguage` ao índice → unificado com a Home.

### 10.4 Ranking "termômetro vivo"

[`src/lib/trakt-index/engine.ts`](../src/lib/trakt-index/engine.ts) ganhou contribuição de recência
no score (antes do sort), via `recencyContribution(...)` (puro/testável):
- **boost** por recência: ≤120d `+60`, ≤545d `+28`, ≤1825d `+8`;
- **damp evergreen**: título > 5 anos **sem** sinal `*_trending` vivo é multiplicado por `0.55`
  (popularidade histórica acumulada não basta — caso `The Big Bang Theory`);
- título antigo **com** spike vivo (`*_trending`) é **poupado** do damp (revival, relançamento,
  nova temporada, viralização real). Cada item expõe `recency { date, ageDays, isRecent,
  hasLiveSpike, isEvergreenWithoutSpike, recencyScore }`.

### 10.5 Identidade POPLOG (IMDb-first)

`resolvePoplogIdentity()` em `trending-feed.ts` resolve **todo item** contra `poplog3Title` antes
da UI: casa por `imdbId` (principal) → `tmdbId+mediaType` (alias), preenchendo `poplogId`/
`hasPoplogId`. ID sintético do índice passou a reusar `syntheticTmdbFromImdbId` (round-trip estável,
sem `Math.random()`) — corrige **P4/R3** e a dedup com IDs sintéticos negativos.

### 10.6 Contrato V2

[`src/lib/trending/trending-contract.ts`](../src/lib/trending/trending-contract.ts):
`TrendingV2Response { language, region, source, realness, cacheStatus, generatedAt, count, items,
languageStats }`; cada `TrendingV2Item` expõe `poplogId, imdbId, traktId, tmdbId, slug, mediaType,
title/overview (projetados), originalTitle, localized{pt-BR,en-US}, poster/backdrop, score, rank,
source, recency, usedFallbackLanguage`. `/api/trending` retorna `source`, `realness`,
`languageStats`, `generatedAt`, `trendingV2` (mantendo `results` para o cliente atual).

### 10.7 Logs/métricas

`[trending/telemetry]` por request: `source`, `realness`, `requestedLanguage`, `resolvedLanguage`,
`hasPtBrData`, `hasEnUsData`, `usedFallbackLanguage`, `incompleteInRequested`, `withPoplogId`.
`[trending/perf]` agora inclui `source` e `realness`.

### 10.8 Regionalidade

O ranking Trakt é **global**; `region` só afeta disponibilidade/cache. A nomenclatura do bloco
permanece "Em alta agora" (sem "no Brasil") — coerente com fonte global.

### 10.9 Testes

`scripts/smoke-test-trending-v2.ts` (`npm run smoke:trending-v2`) — 31 asserts: normalização de
idioma, `pickLocalized` sem contaminação cruzada + fallback, `computeCatalogLanguageStats`,
contrato V2 (projeção pt-BR/en-US, realness, IMDb-first), e ranking de recência (recente >
evergreen-sem-spike; evergreen com spike poupado).

### 10.10 Limitações conhecidas

- Adoção **site-wide** do helper de localização (Home/Hero/Radar/Sorteio/Biblioteca/Para Você/
  SEO/OG) e a matriz de testes cross-módulo de i18n ficaram como **etapa seguinte** (este passo
  entregou o mecanismo reutilizável + aplicação no Trending).
- `localized['pt-BR']` cobre os `translationLimit` (24) primeiros itens do índice; os demais caem
  para en-US via fallback explícito (sinalizado em `usedFallbackLanguage`), sem misturar
  silenciosamente.
- Em cold start o Hero/Home ainda exibem o **fallback local** (agora corretamente marcado como
  `fallback_local`) até o refresh em background popular o trending real.

### 10.11 Validações executadas

- `npm run typecheck` — passou.
- `npm run build` — passou.
- `npm run smoke:trending-v2` — 31/31.
- `npm run smoke:synthetic-id` — 13/13 (regressão do round-trip de ID sintético).
