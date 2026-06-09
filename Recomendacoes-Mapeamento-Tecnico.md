# Mapeamento Técnico: Sistema de Recomendações — Poplog v3

> Gerado em: 2026-06-07

---

## Visão Geral

O sistema de recomendações opera em **três superfícies independentes**, cada uma com pipeline próprio:

| Superfície | Rota | Arquivo principal |
|---|---|---|
| "Mais como este" (página de título) | SSR direto | `src/server/titles/get-title-page-data.ts` |
| "Para Você" (home / `/para-voce`) | `POST /api/user/for-you` | `src/app/api/user/for-you/route.ts` |
| Discovery / Browse | `GET /api/discover` | `src/app/api/discover/route.ts` |

As três superfícies compartilham o mesmo **motor de fusão de rankings** (`RRF engine`) e o mesmo **sistema de política editorial** (`editorial-policy.ts`), mas têm pipelines de seeds, filtragem e scoring diferentes.

---

## 1. Componentes Compartilhados

### 1.1 RRF Engine (`src/server/recommendations/rrf-engine.ts`)

Motor central de fusão. Implementa **Reciprocal Rank Fusion (k=60)** com bônus multi-fonte.

**Fontes suportadas:**
- `Trakt` — títulos relacionados via API Trakt (`/related`)
- `Balloonerismm` — serviço interno (`/recommendations` + `/similar` por IMDb ID)

**Fórmula:**
```
rrfScore(item) = Σ [1 / (60 + posição_na_fonte + 1)]  × (1 + (nº_fontes - 1) × 0.35)
```

Ou seja: item que aparece em **ambas as fontes** recebe +35% de bônus por fonte extra.

**Deduplicação:** por IMDb ID. Itens sem IMDb ID não participam do RRF e são acrescentados no final.

**`fetchBalloonerismm(imdbId, mediaType)`:**
- Chama `/recommendations` e `/similar` em paralelo
- Faz deduplicação por IMDb ID, recomendações primeiro
- Retorna `[]` quando `BALLOONERISMM_ACTIVE` não está ativo

### 1.2 Política Editorial (`src/lib/personalization/editorial-policy.ts`)

Sistema de scoring por sinais de usuário aplicado sobre itens em todas as superfícies.

**Pesos dos sinais:**

| Sinal | Peso base |
|---|---|
| Favorito | +100 |
| Liked | +35 |
| Boosted | +20 |
| Dismissed from section | -25 |
| Disliked | -45 |
| Not interested | -70 |
| Hidden | -1000 |
| Rating alto (≥ 4) | +35 |
| Rating baixo (≤ 2.5) | -45 |

**Multiplicadores por superfície:**

| Superfície | Multiplicador |
|---|---|
| Hero | 1.6× |
| For You | 1.35× |
| Radar | 1.2× |
| Contextual | 0.8× |
| Trending | 0.7× |
| Search | 0.25× |
| Title Page | 0.1× |
| Library | 0× |

**Regras de neutralização:**
- Favorito neutraliza: `not_interested`, `disliked`, `dismissed`
- Liked / status de biblioteca neutraliza: `not_interested`, `dismissed`
- `shouldExclude = true` quando `hidden` ou `not_interested`, exceto em search, title_page e library

### 1.3 Editorial Origin Ranker (`src/server/recommendations/editorial-origin-ranker.ts`)

Re-ranker secundário (atualmente com `fetchRecommendationEditorialDetails` retornando `null` — **desativado na prática**). A lógica está implementada mas não executa enriquecimento de metadados das recomendações.

Quando ativo, calcularia um boost de 0–28 pts baseado em:
- Match exato de produtora/rede com o título de origem: +16 pts
- Match de família editorial (ex: Marvel ↔ Disney): +10 pts

---

## 2. Superfície 1 — "Mais como este" (Página de Título)

**Arquivo:** `src/server/titles/get-title-page-data.ts`  
**Componente UI:** `src/features/title/TitleRecommendations.tsx`  
**Máximo entregue ao cliente:** 12 itens

### Pipeline

```
1. Resolve IMDb ID, Trakt ID, Trakt Slug do título corrente
         ↓
2. getUnifiedRelated() — em paralelo:
   ├── Trakt /related (imdbId ou traktId ou traktSlug) → CatalogSearchResult[]
   └── fetchBalloonerismm(imdbId) → BalloonRelatedItem[]
         ↓
3. applyRRF({ Trakt, Balloonerismm })
   - Itens com IMDb ID: fusão por RRF
   - Itens Trakt sem IMDb ID: adicionados ao final (pass-through)
         ↓
4. filterRelatedOutsideUserLibrary()
   - Exclui títulos já na biblioteca do usuário (todos os status, incluindo abandonados)
   - Exclui por tmdbId, imdbId sintético e imdbId real
         ↓
5. enrichRelatedWithPtBrTitles()
   - Para cada item: GET /translations/pt no Trakt (cache TTL=86400s)
   - Aplica título pt-BR quando diferente do original
         ↓
6. enrichRelatedWithLocalImages()
   - Lookup em poplog3Title por tmdbId
   - Preenche posterPath e backdropPath do cache local (prioridade sobre Trakt CDN)
         ↓
7. slice(0, 12) → recommendationFromCatalogResult()
   - Monta TitleRecommendation: id, tmdbId, imdbId, slug, mediaType, título, ano, poster
```

**Identificação do link:**  
`imdbId ?? traktSlug ?? traktId ?? tmdbId ?? title`

**Não aplica** scoring de feedback do usuário (multiplicador da superfície `title_page` é 0.1× — quase sem efeito).

---

## 3. Superfície 2 — "Para Você" (`/api/user/for-you`)

**Arquivo:** `src/app/api/user/for-you/route.ts`  
**Método:** POST com `{ titles, exclude, limit }`  
**Default:** 6 itens (1 featured + 5 restantes)  
**Máximo:** 30 itens

### Pipeline Detalhado

#### FASE 1 — Sementes da biblioteca

A biblioteca do usuário é usada como **sementes** para buscar títulos relacionados.

**Pesos de categoria:**

| Status | Peso base |
|---|---|
| Favorito | 100 |
| Em andamento (watching) | 85 |
| Assistido (watched) | 70 |
| Watchlist | 45 |
| Geladeira (fridge) | 20 |
| Abandonado | Ignorado completamente |

**Bônus de recência:**
- ≤ 7 dias: +25
- ≤ 30 dias: +15
- ≤ 90 dias: +8
- Mais antigo: +0

**Seleção de seeds:** até 12 seeds, com diversidade forçada de mediaType (mínimo 2 filmes + 2 séries quando disponíveis). Jitter ±20 aleatoriza seeds de peso igual entre sessões.

#### FASE 2 — Labels pt-BR das sementes

Busca `poplog3Title.title` no DB local para cada seed (previne `[object Object]` nos textos de reason).

#### FASE 3 — Resolução de IDs externos

Para cada seed: resolve `imdbId`, `traktId`, `traktSlug` via:
1. Synthetic tmdbId → deriva imdbId diretamente
2. Fast path: campos em UserTitle (`imdb_id`, `externalIds`)
3. DB lookup em `titleExternalId`

#### FASE 4 — Trakt Related + Balloonerismm em paralelo

Ambas as fontes executam **sempre em paralelo** para todas as seeds:

- **Trakt:** todas as seeds de uma vez (`extended=full,images,translations`)
  - `images`: poster/fanart (Trakt VIP — graceful fallback se indisponível)
  - `translations`: títulos pt-BR inline por item
- **Balloonerismm:** até 6 seeds, concorrência máxima 4 simultâneas

#### FASE 4c — RRF por semente

Para cada seed individualmente:
1. Normaliza Trakt e Balloon para `RRFSourceItem[]`
2. Aplica `applyRRF({ Trakt, Balloonerismm })`
3. Itens resultantes viram `RecCandidate[]` com `seedEffectiveWeight` e `relationStrength` (0–100)

#### FASE 5 — Agregação e deduplicação

- Exclui títulos da biblioteca (por `tmdbId`, `imdbId`, `traktSlug`)
- Exclui títulos da sessão atual (parâmetro `exclude`)
- Deduplicação tri-chave: `mediaType:tmdbId`, `mediaType:imdbId`, `mediaType:normTitle:ano`
- **Expansão de IDs sintéticos:** títulos salvos com ID negativo (Balloon-only) têm seus IDs reais resolvidos no DB para bloquear corretamente

#### FASE 6 — Enriquecimento canônico com DB local

Aplica sobre todos os candidatos:
- Título e overview (DB → overwrite Trakt quando não tem pt-BR)
- Imagens TMDB (posterPath, backdropPath — preferido sobre Trakt CDN)
- voteAverage, voteCount, genres

#### FASE 6b — Localização pt-BR via Trakt translations

Para candidatos ainda sem pt-BR: GET `/movies/{id}/translations/pt` ou `/shows/{id}/translations/pt`.  
Cap: top 60 candidatos por score, concorrência máxima 8.

#### FASE 7 — Filtro `not_interested`

Query em `userTitleFeedback` para todos os candidatos. Exclui itens com `feedbackType=not_interested AND active=true`.

#### FASE 8 — Pool com preferência por imagens

- Pool primário: candidatos **com imagem** (poster ou backdrop)
- Se insuficiente: inclui candidatos sem imagem

#### FASE 9 — Suplementação com DB local

Se `withImages < FINAL_COUNT`: busca títulos populares em `poplog3Title` (`voteAverage ≥ 5`, ordered by `popularity DESC`, take 60) para cada mediaType, filtrando excluídos e dedups da sessão.

#### FASE 10 — Seleção ponderada (roulette-wheel)

**Função de score:**
```
score(c) = seedEffectiveWeight + relationStrength×0.3 + log10(voteCount+1)×10
         + (poster?20:0) + (backdrop?12:0) + (overview?3:0) + (year?1:0)
         + (genres?1:0) + (pt-BR?5:0)
```

Seleção sem reposição: alta probabilidade para itens de alta pontuação, mas todos têm chance.

#### FASE 11 — Payload canônico

**Featured item:** maior rating entre os que têm backdrop; fallback para primeiro item.

**`linkId` canônico:**
- Título no DB local → `String(tmdbId)` (link direto)
- Título não no DB → `imdbId` (página carrega via Balloonerismm)
- Fallback: `String(tmdbId)`

---

## 4. Superfície 3 — Discovery / Browse

Duas rotas com propósitos distintos:

### `/api/poplog3/discover` (rota legada)
**Arquivo:** `src/app/api/poplog3/discover/route.ts`

Fonte única: **Trakt** via `catalogGetPopular` / `catalogGetByGenre`.  
Sem personalização, sem RRF.  
Parâmetros: `type` (movie/tv/all), `page`, `genre` (TMDB genre ID).

### `/api/discover` (rota atual com personalização)
**Arquivo:** `src/app/api/discover/route.ts`

```
1. Tenta Balloonerismm (catalogGetPopular via traktAdapter)
   ├── ≥5 resultados → aplica applyUserFeedbackScoring() e retorna
   └── < 5 → fallback
         ↓
2. Fallback: DB local (poplog3Title por popularity DESC, take 20)
   └── aplica applyUserFeedbackScoring() e retorna
         ↓
3. Fallback final: retorna lista vazia
```

**`applyUserFeedbackScoring`** aplica a política editorial completa, reordenando por `personalScore`. Contexto: `"discovery"` → superfície `"radar"` → multiplicador 1.2×.

---

## 5. Radar (`/api/radar`)

**Arquivo:** `src/app/api/radar/route.ts`  
**Engine:** `src/server/radar-trakt/radar-trakt-engine.ts`

O Radar é uma superfície de **agenda/calendário**, não de recomendações no sentido estrito. Exibe lançamentos e eventos próximos.

**Modos:**
- `general` — conteúdo popular/editorial, sem usuário. Cache compartilhado por região/idioma.
- `personal` — filtra por biblioteca do usuário (`applyRadarPersonalFilter`). Sem cache (ou `max-age=60` para anônimos).

**Score dos itens do Radar** (`src/lib/radar/score.ts`):
- Popularidade TMDB (0–35 pts, curva log2)
- Qualidade/engajamento (0–25 pts)
- Tier editorial de rede/produtora (0–30 pts, Tier 1/2/3)
- Trending boost (0–20 pts, diferenciado por idioma)
- Disponibilidade Brasil (0–15 pts)
- Contexto temporal: retorno de temporada/estreia/finale (0–20 pts)
- Origem/idioma: BR +15, en +10, es +5

**Elegibilidade** (`src/lib/radar/eligibility.ts`):
- Hard blocks: novelas diárias, esportes, notícias, podcasts, conteúdo pré-escolar explícito, doramas sem distribuição global
- Soft penalties: infantil genérico (-30), religioso de nicho (-35), baixa relevância BR (-15)

---

## 6. Diagnóstico: Estado Atual e Pontos de Atenção

### ✅ O que funciona bem
- RRF com multi-source bonus está implementado e logado
- Expansão de IDs sintéticos para bloquear duplicatas da biblioteca
- Enriquecimento pt-BR em duas camadas (inline Trakt + endpoint dedicado)
- Filtro `not_interested` ativo no "Para Você"
- Fallback em cascata em todas as superfícies
- Score visual pesado (poster +20, backdrop +12) garante resultados com imagem

### ⚠️ Pontos de atenção
- **`editorial-origin-ranker.ts` está desativado na prática:** `fetchRecommendationEditorialDetails` retorna `null` sempre. O re-ranker por origem editorial não tem efeito.
- **Discovery `/api/poplog3/discover` não tem personalização** — não aplica feedback do usuário.
- **`BALLOONERISMM_ACTIVE`** controla globalmente todas as três superfícies. Quando inativo, apenas Trakt alimenta o RRF.
- **Superfície `title_page` tem multiplicador 0.1×** — feedback do usuário quase não afeta as recomendações na página de título.
- **Suplementação por DB local** (Fase 9 do "Para Você") pode retornar títulos genéricos populares sem relação com os seeds do usuário, especialmente quando a biblioteca é pequena ou os seeds têm poucos relacionados no Trakt.
- **Balloonerismm no "Para Você"** é limitado a 6 seeds com concorrência 4 — seeds restantes (até 12) só usam Trakt.
