# Radar POPLOG — Relatório de Status Completo
> Gerado em: 2026-05-24  
> Baseado no código atual em `src/`

---

## 1. Visão Geral da Arquitetura

```
BDS (ICS feed) ──► parseIcsContent ──► runIcsEngine ──► enrichSeriesGroups ──► applyRetrofill
                                                                                      │
TMDB trending ──► (score boost only)                                                  │
TMDB cinema   ──► fetchCinemaReleasesBR ──────────────────────────────────────────────┘
                                                                                      │
                                     applyRealityClassifier ──► computeRelevanceScore │
                                                                                      │
                                     ── RAW_BDS_MODE? ──────────────────────────────► sections
                                     │  true → clusters por data (sem caps)           │
                                     │  false → section-scorer (com caps)             │
                                                                                      │
                                     cache persistente (TTL 24h) ◄──────────────────────┘
                                              │
                              /api/radar ──────────────────────► RadarClient (SSR + CSR)
```

**Regra arquitetural permanente:**  
Banco de Séries (BDS via ICS) é a ÚNICA fonte de séries no Radar.  
TMDB é apenas enriquecimento (metadata, imagens, score) e cinema (filmes teatrais).

---

## 2. Fontes de Dados

### 2.1 BDS (Banco de Séries) — LIGADA ✅
- **URL:** `http://bancodeseries.com.br/ical.php`
- **Formato:** ICS/iCalendar
- **Janela:** próximos 30 dias a partir de hoje
- **Parsing:** `parseIcsContent` → eventos com `seriesTitle`, `season`, `episode`, `startAt`, `endAt`, `uid`
- **Agrupamento:** `runIcsEngine` → grupos por `normalizeTitleKey(title)`

### 2.2 TMDB — Trending TV — LIGADA PARCIALMENTE (somente score)
- **Endpoint:** `/trending/tv/day` e `/trending/tv/week`
- **Função:** `fetchTrendingIds(window, token)`
- **Uso:** apenas como sinal de boost de score (`trendingBoost: 0-20pts`) em grupos BDS
- **NUNCA cria grupos de série** — os IDs são usados em `computeUnifiedScore` como comparação
- **Resultado:** `trendingDayIds[]` e `trendingWeekIds[]` → repassados ao frontend no payload

### 2.3 TMDB — Enriquecimento de Séries BDS — LIGADA ✅
- **Funções:** `enrichSeriesGroups` (ics-enricher.ts)
- **Para cada grupo BDS:** busca `/search/tv?query=...` + detalhes `/tv/{id}` + imagens
- **Concorrência:** 5 simultâneas (p-limit), throttle 15 req/s, retry em 429/5xx
- **Dados preenchidos:** `tmdb_id`, `name`, `overview`, `poster_path`, `backdrop_path`, `genre_ids`, `genres`, `popularity`, `vote_average`, `vote_count`, `networks`, `production_companies`, `first_air_date`, `status`, `tmdb_type`, `refined_category`
- **RAW_BDS_MODE:** enriquece TODOS os grupos BDS
- **Modo curado:** enriquece apenas `FEATURED_CATEGORIES`

### 2.4 TMDB — Retrofill de Episódios — LIGADA ✅
- **Função:** `applyRetrofill(groups, token)` (tmdb-retrofill.ts)
- **Para cada grupo com tmdb_id:** busca `/tv/{id}/season/{n}` e adiciona o episódio N-1 (imediatamente anterior ao primeiro BDS da temporada)
- **Janela:** episódio anterior dentro dos últimos 14 dias
- **Limite:** `RADAR_RETROFILL_MAX_SEASONS` (default: 600) temporadas por pipeline
- **Deduplicação:** BDS vence TMDB em duplicatas de (season+episode)
- **UIDs retroativos:** prefixo `tmdb_retro_` para identificação
- **Delay entre requests:** 120ms

### 2.5 TMDB — Cinema Teatral — LIGADA ✅ (única fonte TMDB ativa para criação)
- **Função:** `fetchCinemaReleasesBR(token)`
- **Endpoints (paralelos):**
  1. `discover/movie?primary_release_date.gte={-10d}&primary_release_date.lte={hoje}&with_release_type=3` (estreias recentes)
  2. `discover/movie?primary_release_date.gte={amanhã}&primary_release_date.lte={+30d}&with_release_type=3` (estreias futuras)
  3. `movie/upcoming?region=BR` (complementar)
- **Por filme:** `fetchMovieReleaseDateBR` → `/movie/{id}/release_dates` → confirma data theatrical BR (type=3)
- **Concorrência:** 8 simultâneas por batch
- **Tipo:** `eventType: "movie_theatrical_release"`, `source: "tmdb_cinema_release"`
- **dateConfidence:** `cinema_br_confirmed` | `cinema_global_fallback` | `cinema_date_uncertain`

### 2.6 TMDB — Séries Ativas (trending_day, trending_week, airing_today, on_the_air, discover) — DESLIGADA ❌
- **Status:** Removido permanentemente
- **Funções eliminadas:** `fetchTmdbTvList`, `fetchActiveTmdbSeries`, `tmdbTvToGroup`
- **Endpoints desativados:** `/trending/tv/day` (como fonte de série), `/trending/tv/week` (como fonte), `/tv/airing_today`, `/tv/on_the_air`, `/discover/tv` (como criação)
- **`tmdbSeries` é sempre `[]`** — hardcoded no pipeline
- **Garantia:** log `[radar-source] ... tmdbSeries=0` emitido 2x por pipeline
- **Detecção de leak:** loop verifica todos os grupos por `source:"tmdb"` ou `key:"tmdb-tv-*"`

### 2.7 fetchMoviesBR (now_playing / upcoming) — DESLIGADA ❌
- **Status:** Removido permanentemente
- **Substituído por:** `fetchCinemaReleasesBR` (data teatral precisa)
- **`movies[]` sempre vazio** — campo mantido na interface para compatibilidade mas nunca populado

---

## 3. Arquivos e Responsabilidades

### `src/app/api/ics/agenda/route.ts` (1903 linhas)
**Pipeline principal. Endpoint: `GET /api/ics/agenda`**

| Variável de Ambiente | Valor atual | Efeito |
|---|---|---|
| `RADAR_RAW_BDS_MODE` | `"true"` ou ausente | Liga/desliga modo bruto vs. curado |
| `DEBUG_RADAR` | `"true"` ou ausente | Logs detalhados por grupo |
| `TMDB_ACCESS_TOKEN` | token TMDB | Sem este, TMDB não funciona |
| `RADAR_RETROFILL_MAX_SEASONS` | 600 (default) | Limita retrofill |

**Constantes críticas:**
- `CACHE_SCHEMA_VERSION = 7` ✅ (correto)
- `CACHE_TTL_H = 24`
- `ICS_URL = "http://bancodeseries.com.br/ical.php"`

**Fluxo completo:**
1. Fetch do ICS feed (BDS)
2. `parseIcsContent` → eventos
3. `runIcsEngine` → grupos (janela 30d)
4. `fetchTrendingIds("day")` + `fetchTrendingIds("week")` + `fetchCinemaReleasesBR` — em paralelo
5. `enrichSeriesGroups` — TMDB enriquece BDS
6. `applyRetrofill` — episódios retroativos
7. `applyRealityClassifier` + `computeRelevanceScore` — pós-enriquecimento
8. Deduplicação ICS por tmdb_id (variantes regionais preservadas)
9. Filtro estrutural (HIDDEN/DISCARD) — pula em RAW_BDS_MODE
10. Distribuição em seções (raw vs. curado)
11. Cache persistente (somente quando `!RAW_BDS_MODE`)
12. Retorno JSON

**Cache:**
- Leitura: valida `cacheVersion === 7` + `ageHours < 24`
- Escrita: somente quando `!RAW_BDS_MODE`
- Endpoint: `public, s-maxage=300, stale-while-revalidate=60` (modo curado) | `no-store` (RAW)

---

### `src/app/api/radar/route.ts` (160 linhas)
**Endpoint unificado: `GET /api/radar?mode=general|personal`**

- **Modo general:** lê cache persistente → se stale, chama `${SITE_URL}/api/ics/agenda`
- **Modo personal:** chama `agendaEngine.compose(userId, { region: "BR" })`

**BUG CRÍTICO:** `CACHE_SCHEMA_VERSION = 6` (deveria ser 7)  
→ Sempre rejeita o cache persistente → sempre rebuilda o pipeline → latência desnecessária

**Cache-Control:** `"no-store"` (modo general) | `private, max-age=120` (personal autenticado)

---

### `src/app/radar/page.tsx` (65 linhas)
**Server Component da página Radar**

**BUG CRÍTICO:** `CACHE_SCHEMA_VERSION = 5` (deveria ser 7)  
→ `getIcsCache()` sempre retorna `null` → `initialData = null` → RadarClient sempre faz fetch CSR → sem SSR de dados, extra latência no carregamento inicial

**Fluxo:**
```
searchParams?.mode → initialMode (general | personal)
RAW_BDS_MODE === false && initialMode === "general" → getIcsCache() → initialData (sempre null por bug)
→ <RadarClient initialData={null} initialMode={initialMode} />
```

---

### `src/app/radar/RadarClient.tsx` (2816 linhas)
**Client Component — renderização da página**

**Funções principais:**
- `buildRawGroupsForViewMode` — monta pool de grupos para cada tab (Series/Cinema/etc.)
  - **Guard TMDB:** filtra qualquer grupo com `source:"tmdb"` ou `key.startsWith("tmdb-tv-")`, loga warning
- `hydrateSections` — hidrata `RadarSections` a partir do payload JSON
  - Inclui campos `cinemaToday`, `cinemaThisWeek`, `cinemaNext` (corrigido — era bug TS2739)
- `isVisuallyEligible(g)` — exige `tmdb` + `tmdb_id` + imagem útil
- Sets `trendingDay` / `trendingWeek` — usados apenas para badges visuais (não filtram)
- Estado `movies` — sempre `[]` (backend não popula)

**Fetch CSR:**
- Sempre ocorre (initialData é null por bug em page.tsx)
- Chama `GET /api/radar?mode={mode}`
- Atualiza estado ao trocar de mode (general ↔ personal)

---

### `src/lib/ics-engine.ts` (445 linhas)
**Motor de agrupamento e classificação de eventos ICS**

- `runIcsEngine(events, opts)` — janela 30d, agrupa por `normalizeTitleKey`, classifica, ordena
- `filterEnrichedGroup` — MODO BRUTO: sem threshold de score, apenas bloqueia `ALL_BLOCKED_CATEGORIES`
- `computeRelevanceScore` — delega para `computeUnifiedScore` (score.ts)
- Exports retrocompatíveis: re-exporta de `categories.ts`

**Filtros editoriais DESLIGADOS** (comentados em `filterEnrichedGroup`):
- Filtro de idioma (`en/pt/es/ja`) — desligado
- Filtro de `tmdb_type` (Talk Show / Game Show / Soap) — desligado
- Threshold de score (`score >= RELEVANCE_THRESHOLD`) — desligado

---

### `src/lib/ics-enricher.ts` (531 linhas)
**Enriquecimento TMDB para grupos BDS**

- `enrichSeriesGroups(groups, opts)` — pipeline principal, p-limit 5, throttle 15 req/s
- `enrichGroup(group, token)` — por grupo: `searchTmdbTv` + `fetchTvDetails`
- `searchTmdbTv(title, token)` — 2 tentativas: título completo → título sem sufixo regional
- `pickBestResult(results, cleaned, preferAnimation, regionalSuffix)` — prioridade: animação → exact+country → exact → country → fallback
- `extractRegionalSuffix("The Assembly UK")` → `{ base: "The Assembly", suffix: "UK" }`
- `enrichTopGroups` — legado, não usado no pipeline principal

**Sufixos regionais suportados:** UK, US, AU, NZ, CA, BR, IE, ZA, IN, MX, DE, FR, ES, IT, NL, SE, NO, DK, FI, BE, PT, PL, CH, AT, CZ, HU, RO, GR, TR, IL, JP, KR, CN, TH, PH, SG, HK, TW

---

### `src/lib/radar/categories.ts` (267 linhas)
**Categorias de conteúdo e classificação por título**

**Categorias:**
| Categoria | Visível no Radar | Descrição |
|---|---|---|
| `MOVIE` | ✅ Featured | Filme |
| `CINEMATIC` | ✅ Featured | Drama/Crime/Sci-Fi prestige |
| `SERIES` | ✅ Featured | Série genérica |
| `ANIMATION` | ✅ Featured | Animação |
| `DOCUMENTARY` | ✅ Featured | Documentário |
| `REALITY_PREMIUM` | ✅ Featured | Reality com sinais fortes |
| `REALITY` | ❌ DISCARD | Reality genérico |
| `DAILY_SOAP` | ❌ DISCARD | Novela diária |
| `KIDS` | ❌ DISCARD | Infantil |
| `SPORTS` | ❌ HIDDEN | Esportes |
| `NEWS` | ❌ HIDDEN | Notícias |
| `PODCAST` | ❌ HIDDEN | Podcast |
| `LIVE_EVENT` | ❌ HIDDEN | Evento ao vivo |
| `VARIETY` | ❌ HIDDEN | Talk show / auditório |
| `UNKNOWN` | ⚠️ Secondary | Sem classificação |

**Prioridade editorial (CATEGORY_PRIORITY):** MOVIE(0) → CINEMATIC(1) → SERIES(2) → ANIMATION(3) → DOCUMENTARY(4) → REALITY_PREMIUM(5) → ...

**Classificação por título (`classifyTitle`):** regex patterns para SPORTS, VARIETY, NEWS, PODCAST, KIDS, DAILY_SOAP, ANIMATION (anime), REALITY — fallback = SERIES

**Refinamento TMDB (`refineCategoryFromTmdb`):** usa `tmdb_type` (Soap, Talk Show, News, Reality, Documentary) e `genre_ids` para sobrescrever categoria local

---

### `src/lib/radar/score.ts` (253 linhas)
**Score de relevância unificado (0-120 pts)**

**Componentes:**
| Componente | Faixa | Critério |
|---|---|---|
| Popularidade | 0-35 pts | `log2(popularity) * 4.5` |
| Qualidade | -15 a +25 pts | `vote_average/10 * 25` (mín 50 votos) |
| Tier de rede/produtora | 0-30 pts | HBO/Netflix/Apple +30, BBC +20, CBS +10, etc. |
| Trending boost | 0-20 pts | trendingDay+20, trendingWeek+10 (reduzido para ko/zh/th/hi/tl) |
| Origem/idioma | 0-15 pts | BR/pt +15, en +10, es +5, anime-ja +5, outros 0 |

**Threshold de referência:** `SCORE_REFERENCE_THRESHOLD = 38` (somente log/debug — NÃO corta nenhum item)

**Idiomas com trending reduzido (50%):** ko, zh, th, hi, tl (K-drama/C-drama)  
**Anime:** `ja` + genre 16 (Animation) → boost completo, não agrupado com ko/zh

---

### `src/lib/radar/section-scorer.ts` (215 linhas)
**Score temporal para distribuição em seções (modo curado)**

**Buckets temporais:**
| Bucket | Janela | Temporal bonus |
|---|---|---|
| `todayStrict` | hoje | +30 |
| `yesterdayStrong` | ontem | +25 |
| `recentStrong` | últimos 7d | +15 |
| `nearFuture` | amanhã a +3d | +12 |
| `midFuture` | +4d a +7d | +8 |
| `farFuture` | +8d a +30d | +4 |
| `undated` | sem data | +5 |
| `overflow` | fora da janela | 0 |

**Caps por seção (modo curado):**
| Seção | Anime | Reality Premium | Game Show | Sem TMDB |
|---|---|---|---|---|
| Hoje | 2 | 3 | 1 | 2 |
| Semana | 4 | 4 | 2 | 4 |
| 30 dias | 4 | 3 | 1 | 2 |

**Limites de itens por seção:**
- Hoje: min 8, max 20 (fill com `recentStrong` se < 8)
- Semana: max 36
- 30 dias: max 60

---

### `src/lib/radar/tmdb-retrofill.ts` (401 linhas)
**Preenchimento retroativo de episódios**

- **Regra:** para cada grupo BDS com `tmdb_id`, para o episódio mínimo de cada temporada, busca o episódio N-1 no TMDB
- **Fallback:** último episódio com `air_date` dentro dos últimos 14 dias e anterior ao BDS
- **Limite:** 1 episódio retroativo por grupo/temporada
- **Cache em memória:** por `tmdbId_s{season}` — evita requests repetidos
- **Delay:** 120ms entre requests
- **Deduplicação:** BDS vence TMDB em duplicatas de `(season, episode)`

---

### `src/lib/radar/reality-classifier.ts` (180 linhas)
**Classificação REALITY → REALITY_PREMIUM**

- **Trigger:** somente quando `category === "REALITY"` após `refineCategoryFromTmdb`
- **Threshold:** score ≥ 60 → `REALITY_PREMIUM`; abaixo → `REALITY` (descartado)
- **Sinais positivos:** formato de competição (+22), strategy game (+20), dating/makeover (+16), season arc (+10), evento datado (+20), rede premium (+20-30)
- **Penalidades:** cadência diária (-25), alta frequência (-12)
- **Bloqueios estruturais:** Talk Show, News, Soap, VARIETY, PODCAST, SPORTS, LIVE_EVENT → sempre bloqueado independente de score

---

## 4. Distribuição em Seções

### 4.1 Seções do Radar

```
RadarSections {
  today:         IcsSeriesGroup[]   // Destaques (BDS)
  thisWeek:      IcsSeriesGroup[]   // Novos Episódios (BDS)
  next30Days:    IcsSeriesGroup[]   // Vem Aí (BDS)
  cinemaToday:   CinemaReleaseGroup[] // Destaques de Cinema
  cinemaThisWeek:CinemaReleaseGroup[] // Novidades de Cinema
  cinemaNext:    CinemaReleaseGroup[] // Vem Aí de Cinema
}
```

### 4.2 Janelas de Séries (BDS)

| Seção | RAW_BDS_MODE | Modo Curado |
|---|---|---|
| `today` (Destaques) | hoje-3 até hoje | `todayStrict` + `yesterdayStrong` (fill com `recentStrong`) |
| `thisWeek` (Novos Ep.) | amanhã até +7d | `recentStrong`, `nearFuture`, `yesterdayStrong`, `midFuture`, `undated` |
| `next30Days` (Vem Aí) | +8d até +30d + E01 milestones | `farFuture`, `midFuture`, `nearFuture` |

### 4.3 Janelas de Cinema (ambos os modos)
| Seção | Janela |
|---|---|
| `cinemaToday` (Destaques) | últimos 10 dias até hoje |
| `cinemaThisWeek` (Novidades) | amanhã até +10 dias |
| `cinemaNext` (Vem Aí) | +11 dias até +30 dias |

### 4.4 RAW_BDS_MODE — Clustering por Episódio
- Agrupa episódios por `(data + temporada)` → `EpisodeCluster`
- `releasePattern`: `single_episode` | `double_episode` | `episode_range` | `large_batch` | `season_drop` | `full_season`
- Clona o grupo para cada cluster com `sectionMeta` e badges
- Sem caps, sem filtros de score — todos os grupos BDS passam
- Milestones (E01) → sempre vão para `next30Days`

---

## 5. Sistema de Cache

### 5.1 Cache persistente — `ics_agenda_cache`
| Atributo | Valor |
|---|---|
| TTL | 24 horas |
| Schema version | 7 (em agenda/route.ts) |
| Escrita | somente em `!RAW_BDS_MODE` |
| Leitura | sempre em `!RAW_BDS_MODE` |

### 5.2 Bugs de Cache — CRÍTICOS

**BUG 1 — `radar/route.ts` linha 47:**
```typescript
const CACHE_SCHEMA_VERSION = 6; // ERRADO — deve ser 7
```
→ Efeito: `/api/radar?mode=general` sempre rejeita o cache persistente → rebuild a cada request → latência alta

**BUG 2 — `page.tsx` linha 21:**
```typescript
const CACHE_SCHEMA_VERSION = 5; // ERRADO — deve ser 7
```
→ Efeito: `getIcsCache()` sempre retorna `null` → `initialData = null` → RadarClient sem SSR → carregamento lento (fetch CSR obrigatório)

**Fix necessário em ambos:** trocar `= 5` e `= 6` para `= 7`

---

## 6. Código Morto / Dead Code

| Código | Arquivo | Status | Risco |
|---|---|---|---|
| `mergeDedupSeriesByTmdbId` | agenda/route.ts:252 | Chamada com `tmdbSeries=[]` sempre | Inofensivo — resultado sempre 0 deduped |
| `isDateInRange` | agenda/route.ts:178 | Definida, nunca chamada | Inofensivo (não gera erro TS) |
| `enrichTopGroups` | ics-enricher.ts:484 | Não usado no pipeline principal | Mantido por retrocompatibilidade |
| `DEFAULT_BATCH_SIZE`, `BATCH_PAUSE_MS` | ics-enricher.ts:24-25 | Só usado em `enrichTopGroups` | Inofensivo |

---

## 7. Logs de Diagnóstico

| Log prefix | Onde | O que informa |
|---|---|---|
| `[radar-source]` | agenda/route.ts | `ics=N tmdbSeries=0 cinema=M` — conformidade de fonte |
| `[radar-raw-classify]` | agenda/route.ts | Por grupo no RAW_BDS_MODE: category, score, nextAirDate |
| `[radar-raw-accept]` | agenda/route.ts | Grupos que seriam bloqueados mas aceitos em RAW |
| `[radar-dedup]` | agenda/route.ts | Deduplicação por tmdb_id: variantes ou fusão |
| `[radar-error]` | agenda/route.ts | Leak de tmdb-tv-* ou source:"tmdb" — nunca deve aparecer |
| `[radar-raw-sections]` | agenda/route.ts | Contagens por seção no modo RAW |
| `[radar-cinema-sections]` | agenda/route.ts | Contagens cinema por seção |
| `[radar-sections-final]` | agenda/route.ts | Contagens finais de todas as seções |
| `[radar-sections]` | agenda/route.ts | Modo curado: contagens + bucket breakdown |
| `[radar-section-demote]` | agenda/route.ts | Item bloqueado por cap de seção |
| `[radar-section-pick]` | agenda/route.ts | Item aceito em seção (só com DEBUG_RADAR) |
| `[radar-filter]` | agenda/route.ts | Título bloqueado estruturalmente |
| `[radar-debug-title]` | agenda/route.ts | Detalhes de um título específico |
| `[reality-classifier]` | agenda/route.ts | Score e sinais do reality classifier |
| `[ics-enricher]` | ics-enricher.ts | variant-match, fallback-first-result |
| `[radar-retrofill]` | tmdb-retrofill.ts | Por episódio: inspect, fetched, added, skipped, deduped |
| `[cinema-fetch]` | agenda/route.ts | Candidatos e confirmados do pipeline de cinema |
| `[radar-client-guard]` | RadarClient.tsx | Bloqueia group tmdb-tv-* ou source:"tmdb" no frontend |

---

## 8. Modo Debug por Título

**Endpoint:** `GET /api/ics/agenda?debug=<rawTitle|key>`

Retorna relatório detalhado do pipeline para um título específico:
- `step1_local_category` — resultado de `classifyTitle`
- `step2_tmdb` — dados TMDB encontrados
- `step3_refined_category` — resultado de `refineCategoryFromTmdb`
- `step4_filters` — `local_blocked`, `tmdb_type_blocked`, `refined_blocked`, `language_blocked`, `passed_all_hard_filters`
- `step5_score` — breakdown: `popularity_score`, `quality_score`, `network_tier`, `trending_boost`, `origin_boost`, `total`
- `final_score`, `final_relevant`, `discard_reason`

---

## 9. Variáveis de Ambiente Relevantes

| Env var | Tipo | Efeito |
|---|---|---|
| `RADAR_RAW_BDS_MODE` | `"true"` / ausente | Liga modo bruto (sem filtros editoriais, clusters por data) |
| `DEBUG_RADAR` | `"true"` / ausente | Logs verbose por grupo e seção |
| `TMDB_ACCESS_TOKEN` | string | Token Bearer TMDB — sem este, sem TMDB |
| `NEXT_PUBLIC_SITE_URL` | URL | Usado em `radar/route.ts` para chamar `/api/ics/agenda` |
| `RADAR_RETROFILL_MAX_SEASONS` | number (default 600) | Limita consultas de temporada no retrofill |

---

## 10. Resumo de Bugs Ativos

| # | Severidade | Arquivo | Linha | Problema | Fix |
|---|---|---|---|---|---|
| 1 | 🔴 CRÍTICO | `radar/route.ts` | 47 | `CACHE_SCHEMA_VERSION = 6` (deve ser 7) | Trocar para `7` |
| 2 | 🔴 CRÍTICO | `page.tsx` | 21 | `CACHE_SCHEMA_VERSION = 5` (deve ser 7) | Trocar para `7` |
| 3 | 🟡 MENOR | `agenda/route.ts` | 252 | `mergeDedupSeriesByTmdbId` nunca produz resultado (tmdbSeries=[]) | Remover chamada |
| 4 | 🟡 MENOR | `agenda/route.ts` | 178 | `isDateInRange` definida mas nunca chamada | Remover função |

---

## 11. Fluxo de Requisição Completo (estado atual)

```
Usuário acessa /radar
    └── page.tsx (Server Component)
         ├── getIcsCache() → SEMPRE null (bug CACHE_SCHEMA_VERSION=5)
         └── <RadarClient initialData={null} initialMode="general" />

RadarClient monta (CSR)
    └── useEffect: fetch GET /api/radar?mode=general
         └── radar/route.ts
              ├── readIcsCache() → SEMPRE null (bug CACHE_SCHEMA_VERSION=6)
              └── buildGeneralPayload()
                   └── fetch GET /api/ics/agenda (pipeline completo)
                        ├── BDS fetch + parse + engine
                        ├── TMDB trending (score only)
                        ├── TMDB cinema
                        ├── enrichSeriesGroups (BDS → TMDB metadata)
                        ├── applyRetrofill
                        ├── applyRealityClassifier + score
                        ├── dedup ICS
                        ├── distribui seções (raw ou curado)
                        └── writeCache(cache) → cache com version=7

                   ← retorna payload
              ← retorna RadarResponse { mode, general, sections, ... }
    ← RadarClient renderiza
```

**Consequência dos bugs:** cada visita à página força um pipeline completo, incluindo ~N * 3 requests TMDB para enriquecimento + fetches de cinema + retrofill. Com o cache funcionando (versão corrigida para 7 nos 3 arquivos), a segunda visita dentro de 24h seria instantânea.

---

*Relatório gerado automaticamente mapeando todos os arquivos do pipeline Radar.*
