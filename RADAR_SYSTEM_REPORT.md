# Radar — Estado do Sistema: Regras, Pesos, Filtros e Dados

**Data:** 2026-05-23  
**Versão do pipeline:** Modo Bruto (sem filtros editoriais)

---

## 1. Visão Geral da Arquitetura

```
ICS Feed (bancodeseries.com.br)
    └─ parseIcsContent()         → lista de IcsEvent (bruto)
        └─ runIcsEngine()        → IcsSeriesGroup[] (agrupados, 30 dias)
            └─ enrichSeriesGroups()  → TMDB enrichment (featured only)
                └─ computeRelevanceScore()  → score 0-100 (ordenação)
                    └─ filterEnrichedGroup()  → passa/bloqueia
                        └─ buildAgendaPayload()  → IcsAgendaResponse
                            └─ cache persistente (TTL 24h)
                                └─ /api/radar → RadarClient
```

**Modo Geral** serve `IcsAgendaResponse` (pipeline ICS + TMDB).  
**Modo Personalizado** serve `AgendaV2CompatResponse` (AgendaEngine com dados do usuário).

---

## 2. Categorias de Conteúdo

### FEATURED — exibidas no Radar
| Categoria | Descrição |
|---|---|
| `CINEMATIC` | Filmes de prestígio, cinema de arte |
| `SERIES` | Séries de ficção/drama |
| `ANIMATION` | Animação (todas as faixas etárias) |
| `DOCUMENTARY` | Documentários |
| `REALITY_PREMIUM` | Reality shows curados (detectados por título) |

### HIDDEN — bloqueadas estruturalmente (não editoriais)
| Categoria | Motivo |
|---|---|
| `SPORTS` | Fora do escopo do produto |
| `NEWS` | Fora do escopo do produto |
| `PODCAST` | Fora do escopo do produto |
| `LIVE_EVENT` | Eventos ao vivo efêmeros |

### Secundárias — recebidas, não exibidas em destaque
`REALITY`, `DAILY_SOAP`, `KIDS`, `VARIETY`, `UNKNOWN`

---

## 3. Score de Relevância (0–100)

O score é **calculado em todos os grupos** com TMDB, mas no **Modo Bruto não corta nenhum conteúdo** — serve apenas para ordenação futura.

| Componente | Pontos máx | Regra |
|---|---|---|
| **1. Popularidade** | 35 | Curva log: `min(35, log2(max(1, pop)) * 4.5)` — pop=10→15pts, pop=200→31pts |
| **2. Qualidade** | 25 | `(vote_avg/10) * 25` se ≥50 votos; metade se 10–49; −15 se <10 |
| **3. Rede/Produtora** | 30 | Tier de prestígio da rede ou produtora (pega o maior, não soma) |
| **4. Trending** | 20 | +20 trending day; +10 trending week; +5 se jp/anime |
| **5. Idioma de origem** | 10 | en/pt=+10; es/ja=+5; outros=+0 |

**Threshold histórico:** `RELEVANCE_THRESHOLD = 38` — definido no código, mas **desligado** no Modo Bruto.

### Viés de idioma no scoring (ainda ativo)
O score tem viés embutido mesmo sem threshold:
- `ko`, `zh`, `th`, `hi`, `tl` — **sem trending boost** (componente 4 = 0)
- `ja` — trending boost reduzido (+5 max)
- `en`, `pt` — +10 pts de origem; trending boost completo
- Resultado: conteúdo asiático chega com score 10–20 pts menor que equivalente em inglês de mesma popularidade

---

## 4. Filtros Ativos vs Desligados

### ATIVOS (bloqueiam conteúdo)
| Filtro | Onde | O que faz |
|---|---|---|
| `HIDDEN_CATEGORIES` | `filterEnrichedGroup()` | Bloqueia SPORTS, NEWS, PODCAST, LIVE_EVENT |
| `refined_category` HIDDEN | `filterEnrichedGroup()` | Se TMDB reclassifica para categoria oculta, bloqueia |
| Validação técnica de filmes | `buildAgendaPayload()` step filmes | Descarta filmes sem `tmdb_id` ou sem `name` |
| Deduplicação de filmes | `buildAgendaPayload()` | Por `tmdb_id`, prioriza `now_playing` sobre `upcoming` |

### DESLIGADOS (código preservado, comentado)
| Filtro | Localização | O que fazia |
|---|---|---|
| Hard filter de idioma | `filterEnrichedGroup()` | `["en","pt","es","ja"]` — bloqueava tudo fora dessa lista |
| Hard filter de tipo TMDB | `filterEnrichedGroup()` | Bloqueava Talk Show, Game Show, News, Soap |
| Threshold de score | `filterEnrichedGroup()` | `score >= 38` — cortava ~40% do conteúdo |
| Cap asiático no feed | `buildEditorialGroups()` | Máx 2 conteúdos asiáticos por idioma no feed geral |
| Cap asiático no spotlight | `buildSpotlightItems()` | Máx 1 conteúdo asiático no hero carousel |
| Penalidades de diversidade | `buildEditorialGroups()` | Penalizava repetição de provider, idioma e gênero |
| Cap de filmes | `buildAgendaPayload()` | `.slice(0, 20)` — limitava a 20 filmes |
| Janela temporal de filmes | `buildAgendaPayload()` | Filmes apenas dentro de 14 dias |

---

## 5. Fluxo de Dados Detalhado

### Servidor (`/api/ics/agenda`)
```
1. Fetch ICS feed (bancodeseries.com.br)
2. parseIcsContent()     → IcsEvent[] (bruto, sem filtro)
3. runIcsEngine()        → IcsSeriesGroup[] (30 dias, sort=nextAir)
   └─ classifyTitle()    → ContentCategory por regex de título
   └─ HIDDEN_CATEGORIES  → grupos ocultos excluídos do resultado
4. fetchTrendingIds()    → Set<tmdb_id> day + week (TMDB API)
   fetchMoviesBR()       → now_playing + upcoming BR (TMDB API)
5. enrichSeriesGroups()  → TMDB details para FEATURED_CATEGORIES
   └─ concurrency=5, sem rate-limit manual
6. computeRelevanceScore() → score 0-100 (todos os grupos c/ TMDB)
   └─ isRelevant = true (modo bruto — score não corta)
7. featuredGroups = filter(FEATURED_CATEGORIES && !HIDDEN)
   secondaryGroups = filter(!FEATURED_CATEGORIES && !HIDDEN)
8. Dedup filmes por tmdb_id
9. [NOVO] Log estruturado no console do servidor
10. Salva no cache persistente (TTL 24h)
```

### Cliente (`RadarClient.tsx`)
```
1. SSR quente: initialData já pronto do cache persistente
2. Se cache frio: client-side fetch /api/ics/agenda
3. buildSpotlightItems()  → hero carousel (sem filtros, slice 20)
4. buildEditorialGroups() → grid editorial por dia/semana/mês
   └─ deduplicação por chave (group.key + data)
   └─ ordenação por relevanceScore desc
5. Modo Geral: AgendaEditorialFeed (grid de cards)
6. Modo Personalizado: PersonalRadarPanel (AgendaEngine data)
```

---

## 6. Imagens TMDB — Tamanhos Atuais (pós-otimização)

| Contexto | Tipo | Tamanho |
|---|---|---|
| Hero / Spotlight backdrop | Backdrop | `w1280` |
| Hero / Spotlight poster | Poster | `w500` |
| Cards editoriais backdrop | Backdrop | `w780` |
| Cards editoriais poster | Poster | `w500` |
| Thumbnails de episódio (still) | Still | `w1280` |
| Thumbnail pequena (carrossel) | Poster | `w342` |
| Ícone de provedor (logo) | Logo | `w92` |
| Fotos de pessoa | Profile | `w185` |
| Título page backdrop | Backdrop | `w1280` ✓ |
| Título page poster | Poster | `w500` ✓ |
| Library Hero | Backdrop | `w1280` ✓ |
| StartSeriesBanner backdrop | Backdrop | `w1280` ✓ |
| StartSeriesBanner poster | Poster | `w500` ✓ |
| HeroSlide backdrop | Backdrop | `w1280` ✓ |

`original` **eliminado de todos os contextos de imagem** (era usado em 4 lugares).

---

## 7. Log de Pipeline (novo)

A cada execução completa do pipeline, o servidor imprime no console:

```
+- [ICS Agenda] PIPELINE RESUMO -----------------------------------
|  ICS -> grupos brutos     : 312
|  Com TMDB enriquecido    : 187 / 312
|  Bloqueados (HIDDEN_CAT) : 24
|  Featured finais         : 163
|    sem TMDB (pendente)   : 8
|    com score calculado   : 155
|  Secondary (outras cat)  : 125
|  Filmes (BR)             : 38
|
|  Score min / med / max   : 0 / 42 / 91
|  Top idiomas             : en:72  ko:28  ja:19  pt:17  es:12  zh:8
|  Cats featured           : SERIES:98  ANIMATION:31  CINEMATIC:22  DOCUMENTARY:12
|  trendingDay / Week      : 20 / 20 ids
+-------------------------------------------------------------------
```
*(valores ilustrativos — reais aparecem no console do servidor)*

---

## 8. Pendências e Observações Técnicas

### Score tem viés de idioma embutido (componente 4 e 5)
O trending boost e o bônus de origem ainda favorecem `en/pt` mesmo sem threshold. Impacto: conteúdo asiático de alta qualidade pode aparecer ordenado abaixo de conteúdo menos popular em inglês. Para neutralizar completamente: comentar ou zerar os componentes 4 e 5 do `computeRelevanceScore`.

### Três sistemas de score paralelos
- **Servidor:** `computeRelevanceScore()` em `ics-engine.ts` — usa `log2`, range 0-100
- **Cliente (AgendaClient):** score inline em `buildEditorialGroups()` — usa `log10`-style, range diferente
- **RadarClient:** usa `relevanceScore` do servidor diretamente
Os três nunca são reconciliados. Em Modo Bruto isso não causa perda de dados — apenas ordenações ligeiramente diferentes por contexto.

### VARIETY não está em HIDDEN_CATEGORIES
Conteúdo classificado como `VARIETY` passa pelos filtros técnicos mas não entra em `FEATURED_CATEGORIES`. Aparece em `secondaryGroups` — visível no log mas não renderizado no Radar atual.

### `refined_category` via TMDB pode reclassificar silenciosamente
Se o TMDB classifica um grupo com `tmdb_type = "Talk Show"`, o `refineCategoryFromTmdb()` pode mudar sua categoria para `PODCAST` → bloqueado por `HIDDEN_CATEGORIES`. Esse caminho está documentado mas não logado individualmente. Para auditar: usar `?debug=<título>` na API.

### Cache persistente TTL = 24h
O pipeline completo executa em média 8–15s (enriquecimento TMDB). Se o cache estiver frio, a primeira requisição do dia é lenta. Para forçar rebuild: qualquer request com cache stale aciona o pipeline automaticamente.
