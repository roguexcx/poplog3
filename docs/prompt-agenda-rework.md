# POPLOG — Rework Estrutural da Engine da Agenda

> **Para uso em Claude / Codex (modo código)**
> Este prompt pressupõe acesso ao repositório `poplog-v3`. Trabalhe com os arquivos reais, não produza pseudo-código.

---

## Contexto do projeto

**POPLOG** é uma plataforma de acompanhamento cinematográfico e de séries construída em **Next.js 15 (App Router) + TypeScript + cache persistente + TMDB API**.

### Arquitetura atual relevante

```
src/
├── app/
│   ├── agenda/
│   │   └── page.tsx                          # Página da Agenda (~1600 linhas, monolítica)
│   └── api/poplog3/
│       ├── agenda/
│       │   ├── route.ts                      # Endpoint legado
│       │   ├── v2/route.ts                   # Endpoint v2 (wrapper)
│       │   └── leaving-soon/route.ts
│       └── continuity/
│           ├── new-episodes/route.ts
│           └── upcoming-episodes/route.ts
├── server/agenda/
│   ├── agenda-engine.ts                      # Engine principal (~712 linhas)
│   ├── discover-service.ts                   # Wrapper TMDB Discover
│   ├── temporal-layer-engine.ts              # Classificação de camadas temporais
│   ├── priority-monitor.ts                   # Monitor de títulos prioritários
│   └── types.ts                             # Tipos centrais da Agenda
└── features/agenda/
    ├── AgendaNewEpisodeCard.tsx
    ├── AgendaPersonalSection.tsx             # Grid estático 2 colunas
    ├── AgendaProviderSection.tsx             # Scroll horizontal de posters
    └── cards/
        ├── HiatusReturnBanner.tsx
        └── SeasonFinaleCard.tsx
```

### Tipos centrais já existentes (manter compatibilidade ou migrar com clareza)

Os tipos em `src/server/agenda/types.ts` já modelam bem o domínio:
- `AgendaEventType` — 10 tipos de evento (episódio, estreia, streaming, etc.)
- `AgendaTemporalLayer` — 7 camadas temporais (today → beyond)
- `AgendaEvent` — objeto central com `visualWeight: "hero" | "card" | "row"`
- `AgendaV2CompatResponse` — resposta atual que mistura estrutura v2 com legado

### Problemas identificados no código atual

1. **`page.tsx` é um monólito de ~1600 linhas** com fetch, lógica de negócio, estado e UI misturados
2. **`AgendaPersonalSection`** renderiza todos os eventos num grid 2 colunas genérico, ignorando `visualWeight`
3. **`AgendaProviderSection`** é uma fila horizontal de posters sem contexto temporal ou de continuidade
4. **`agenda-engine.ts`** faz chamadas TMDB em paralelo mas sem priorização baseada no estado do usuário
5. **`AgendaV2CompatResponse`** mantém arrays legados (`nowPlaying`, `airingToday`, etc.) que duplicam o que `timeline` já resolve
6. **A engine não usa `visualWeight`** de forma estratégica — `hero` nunca é diferenciado visualmente
7. **Não há heatmap, countdown nem calendário** — a UI é só listas e scrolls horizontais
8. **`discover-service.ts` é subutilizado** — só é chamado para alguns cenários, não como núcleo da curadoria

---

## Objetivo

Fazer o **rework estrutural completo** da Agenda POPLOG, transformando-a de um agregador cronológico passivo em uma **engine temporal viva** que entende:

- O que o usuário está acompanhando, está atrasado, pausou ou quer monitorar
- O que está indo ao ar hoje, essa semana, esse mês
- O que chegou (ou vai chegar) no streaming favorito do usuário
- Grandes eventos: finales, retornos de hiato, estreias de temporada, blockbusters
- Curadoria editorial: fenômenos da semana, franquias em andamento, hype global

A página final deve ser **visualmente cinematográfica**, com hero dinâmico, countdowns, timeline viva e cards contextuais — inspirada na imagem de referência da Home POPLOG.

---

## Etapas de implementação

> Execute na ordem. Cada etapa deve produzir código funcional antes de avançar.

---

### Etapa 1 — Audit e definição dos novos tipos

**Arquivo:** `src/server/agenda/types.ts`

Revisar e expandir os tipos existentes. Não quebrar imports sem migrar junto.

**O que adicionar/alterar:**

```typescript
// Nível de confiança para datas (especialmente filmes e streamings)
export type DateConfidence = "confirmed" | "probable" | "estimated" | "unknown";

// Contexto de continuidade do usuário para um evento
export type UserContinuityContext =
  | "up_to_date"        // assistindo e em dia
  | "behind"            // atrasado (episodesBehind > 0)
  | "catching_up"       // maratonando
  | "waiting_season"    // prefere esperar temporada completa
  | "paused"            // pausou
  | "not_started"       // nunca assistiu
  | null;               // sem dados

// Bloco editorial para seções de destaque
export type EditorialBlock = {
  id: string;
  label: string;           // ex: "Fenômeno da Semana"
  anchorId: number;        // tmdbId do título âncora
  mediaType: "movie" | "tv";
  reason: string;          // ex: "Última temporada disponível"
  relatedIds?: number[];   // outros títulos do bloco
};

// Expandir AgendaEvent
export type AgendaEvent = {
  // ... campos existentes mantidos ...
  dateConfidence: DateConfidence;          // NOVO
  userContinuityContext: UserContinuityContext; // NOVO
  countdownMs?: number | null;             // NOVO — ms até o evento
  isMonitored?: boolean;                   // NOVO — título em monitoramento prioritário
  networkName?: string | null;             // NOVO — Netflix, HBO, etc.
  providerLogoPath?: string | null;        // NOVO — logo do provider via TMDB
  tagline?: string | null;                 // NOVO — para hero/card grande
};

// Novo formato de resposta da API (substitui AgendaV2CompatResponse no futuro)
export type AgendaEngineResponse = {
  personal: {
    today: AgendaEvent[];
    thisWeek: AgendaEvent[];
    upcoming: AgendaEvent[];
    leavingSoon: AgendaEvent[];
    behind: AgendaEvent[];          // atrasados, ordenados por prioridade
  };
  global: {
    cinemaHighlights: AgendaEvent[];
    streamingArrivals: AgendaEvent[];   // chegando nos providers favoritos
    heatmapEvents: AgendaEvent[];       // eventos de alta relevância/hype
  };
  timeline: AgendaTimelineGroup[];
  editorial: EditorialBlock[];
  meta: {
    generatedAt: string;
    region: string;
    userHasLibrary: boolean;
    favoriteProviderIds: number[];
    cacheStrategy: "fresh" | "stale" | "fallback";
  };
};
```

---

### Etapa 2 — Refatorar `agenda-engine.ts`

**Arquivo:** `src/server/agenda/agenda-engine.ts`

Este é o coração do rework. A engine atual faz fetch de tudo e classifica depois. A nova engine deve **priorizar o contexto do usuário primeiro**, depois buscar dados globais.

**Estrutura da nova engine (função principal):**

```typescript
export async function buildAgendaEngine(
  userId: string | null,
  options: { region?: string; providerIds?: number[] }
): Promise<AgendaEngineResponse>
```

**Ordem de execução interna:**

**2.1 — Carregar estado do usuário (se autenticado)**
- Buscar `getUserTitleStates(userId)` → Map de estados por tmdbId
- Extrair: `watchingIds`, `monitoredIds`, `behindIds`, `pausedIds`
- Extrair `favoriteProviderIds` do perfil do usuário (cache persistente)

**2.2 — Buscar episódios pessoais com prioridade**
- Para cada título em `watching`: buscar `next_episode_to_air` e `last_episode_to_air` via TMDB detail (usar `getCachedSeason` quando possível)
- Detectar: hiatus return, season finale, mid-season finale, season premiere
- Calcular `episodesBehind` e `userContinuityContext`
- Montar `personal.today`, `personal.thisWeek`, `personal.behind`

**2.3 — Buscar eventos globais com Discover**

Usar `discoverService` como núcleo. Queries paralelas:

```typescript
// Filmes em cartaz e chegando
const [nowPlaying, upcoming, streamingMovies] = await Promise.allSettled([
  discoverService.movies({ region, dateRange: { start: today, end: today } }),
  discoverService.movies({ region, dateRange: { start: tomorrow, end: in30days } }),
  discoverService.movies({ providerIds: favoriteProviderIds, region }),
]);

// Séries no ar e estreando
const [airingToday, onTheAir, newSeries] = await Promise.allSettled([
  discoverService.tv({ airDateGte: today, airDateLte: today }),
  discoverService.tv({ airDateGte: today, airDateLte: in7days }),
  discoverService.tv({ firstAirDateGte: in0days, firstAirDateLte: in30days }),
]);
```

**2.4 — Cruzar Trending + Popularity para `heatmapEvents`**
- Buscar `trending/all/week` da TMDB
- Cruzar com Discover para filtrar por provider e região
- Score final: `(trending_rank_score * 0.4) + (popularity * 0.3) + (vote_average * vote_count_normalized * 0.3)`

**2.5 — Monitoramento prioritário**
- Para títulos em `monitoredIds`: aplicar cache curto (5min), comparar com estado anterior
- Gerar eventos: `"Novo episódio confirmado"`, `"Mudou de provider"`, `"Estreia adiada"`, `"Chegou ao streaming"`
- Alimentar `personal.upcoming` com alta prioridade

**2.6 — Blocos editoriais**
- Detectar automaticamente candidatos a `EditorialBlock`:
  - Série com finale esta semana → `"Finale de Temporada"`
  - Filme com > 500 trending rank e > 1000 reviews → `"Fenômeno da Semana"`
  - Retorno de hiato de série com popularidade > 100 → `"Está de Volta"`
  - Franquia com 2+ títulos ativos no período → `"Universo [nome] continua"`

**2.7 — Montar `timeline` por camada temporal**
- Reutilizar `buildTemporalTimeline` do `temporal-layer-engine.ts`
- Garantir que cada evento em `timeline` tenha `visualWeight` correto:
  - `hero` → apenas 1 evento por camada (o mais relevante)
  - `card` → até 4 eventos por camada
  - `row` → restante

---

### Etapa 3 — Refatorar `discover-service.ts`

**Arquivo:** `src/server/agenda/discover-service.ts`

O serviço atual é básico. Expandir para ser o núcleo de curadoria.

**Adicionar métodos:**

```typescript
// Títulos chegando a providers específicos
discoverService.arrivingOnProviders(providerIds: number[], region: string, days: number)

// Títulos saindo de providers (leaving soon)
discoverService.leavingProviders(providerIds: number[], region: string, days: number)

// Curadoria por keywords temáticas
discoverService.byKeywords(keywordIds: number[], mediaType: "movie" | "tv")

// Filmes de cinema com alta expectativa
discoverService.theaterHighlights(region: string, minPopularity?: number)

// Franquias com coleções ativas
discoverService.activeCollections(collectionIds: number[])
```

Todos os métodos devem:
- Filtrar talk shows e noticiários por padrão (`without_genres: "10767,10763,10764"`)
- Aceitar `region` e usar `watch_region` quando relevante
- Retornar `DiscoverMediaItem[]` com `dateConfidence` inferida

---

### Etapa 4 — Novo endpoint da API

**Arquivo:** `src/app/api/poplog3/agenda/v3/route.ts` (novo arquivo)

Criar endpoint limpo que use a nova `buildAgendaEngine`:

```typescript
// GET /api/poplog3/agenda/v3?region=BR&providers=8,337,1899
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get("region") ?? "BR";
  const providerIds = searchParams.get("providers")?.split(",").map(Number) ?? [];

  // Auth opcional — agenda funciona sem login, mas fica rica com ele
  const session = await getServerSession();
  const userId = session?.user?.id ?? null;

  const data = await buildAgendaEngine(userId, { region, providerIds });

  return NextResponse.json(data, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}
```

Manter `/v2/route.ts` funcionando durante a transição.

---

### Etapa 5 — Decomposição da `page.tsx`

**Diretório:** `src/features/agenda/`

A `page.tsx` atual tem ~1600 linhas misturando fetch, state e UI. Decompor em:

```
src/features/agenda/
├── hooks/
│   ├── useAgendaEngine.ts          # fetch + state da engine v3
│   ├── useAgendaFilters.ts         # filtros ativos (provider, tipo, camada)
│   └── useCountdown.ts             # countdown em tempo real para eventos
├── layout/
│   ├── AgendaHero.tsx              # Hero dinâmico — 1 evento "hero" por vez
│   ├── AgendaTimeline.tsx          # Timeline viva com grupos temporais
│   ├── AgendaHeatmap.tsx           # Grid visual de intensidade por dia
│   └── AgendaCalendarMonth.tsx     # Visão mensal (opcional, fase 2)
├── sections/
│   ├── AgendaPersonalSection.tsx   # Refatorado — usa visualWeight
│   ├── AgendaProviderSection.tsx   # Refatorado — com contexto temporal
│   ├── AgendaCinemaSection.tsx     # Filmes em cartaz / chegando
│   ├── AgendaEditorialBlock.tsx    # Blocos editoriais (Fenômeno da Semana, etc.)
│   └── AgendaBehindSection.tsx     # "Você está atrasado" — continuidade
├── cards/
│   ├── AgendaEventCard.tsx         # Card genérico que adapta por visualWeight
│   ├── AgendaHeroCard.tsx          # Card grande para eventos hero
│   ├── AgendaCountdownCard.tsx     # Card com countdown visual
│   ├── HiatusReturnBanner.tsx      # (existente, revisar)
│   └── SeasonFinaleCard.tsx        # (existente, revisar)
└── AgendaPage.tsx                  # Componente raiz — orquestra sem lógica
```

**`src/app/agenda/page.tsx`** vira só:

```typescript
import AgendaPage from "@/features/agenda/AgendaPage";
export default function Page() { return <AgendaPage />; }
```

---

### Etapa 6 — UI: Hero Dinâmico

**Arquivo:** `src/features/agenda/layout/AgendaHero.tsx`

O hero deve:
- Exibir o evento mais relevante da camada `today` ou `tonight` com `visualWeight: "hero"`
- Usar `backdrop_path` em full-width com gradiente cinematográfico
- Mostrar: logo transparente (TMDB images/logos) ou título grande, provider badge, countdown, tipo do evento
- Ter transição automática a cada 8s entre os top-3 eventos hero
- Em mobile: aspect-ratio fixo com versão compacta

```typescript
type Props = {
  events: AgendaEvent[];  // filtrados para visualWeight === "hero"
  onSelect: (event: AgendaEvent) => void;
};
```

---

### Etapa 7 — UI: Timeline Viva

**Arquivo:** `src/features/agenda/layout/AgendaTimeline.tsx`

Substituir os grids estáticos por uma **timeline vertical agrupada**:

- Grupos: `AGORA` · `HOJE` · `ESSA SEMANA` · `PRÓXIMA SEMANA` · `ESTE MÊS`
- Cada grupo tem separador visual com label + contagem de eventos
- Dentro de cada grupo: eventos renderizados via `AgendaEventCard` (adapta por `visualWeight`)
- Scroll âncora automático para a camada `today` ao abrir a página
- Indicador "AGORA" pulsante para eventos com countdown < 2h

---

### Etapa 8 — UI: Cards Contextuais

**Arquivo:** `src/features/agenda/cards/AgendaEventCard.tsx`

Card único que adapta sua apresentação ao `visualWeight`:

**`hero`** → `AgendaHeroCard` (delega)

**`card`** → Card médio com:
- Backdrop ou still do episódio (não só poster)
- Badge do tipo: `NOVO EPISÓDIO` / `FINALE` / `ESTREIA` / `CHEGOU AO STREAMING`
- Linha de contexto de continuidade: `"Você está 3 episódios atrás"` / `"Em dia"`
- Countdown se < 72h
- Provider badge (logo pequeno)

**`row`** → Item compacto horizontal:
- Poster pequeno (56×80px) + título + data + badge de tipo

---

### Etapa 9 — UI: Heatmap Semanal (opcional mas recomendado)

**Arquivo:** `src/features/agenda/layout/AgendaHeatmap.tsx`

Visão de intensidade da semana — quantos eventos por dia:

- 7 colunas (dom → sab) com círculos de tamanho/opacidade variável
- Cor por tipo: azul (episódios) · laranja (cinema) · verde (streaming)
- Click num dia → filtra a timeline para aquele dia
- Tooltip com preview dos eventos do dia

---

### Etapa 10 — Verificação e testes

Após implementar todas as etapas:

1. **Verificar tipos:** `npx tsc --noEmit` — zero erros
2. **Verificar imports quebrados:** `grep -r "AgendaV2CompatResponse" src/` — apenas onde ainda é necessário no legado
3. **Testar endpoint v3:** `curl /api/poplog3/agenda/v3?region=BR` — resposta válida com `personal`, `global`, `timeline`, `editorial`
4. **Testar sem usuário logado:** agenda global deve funcionar completamente
5. **Testar com usuário com biblioteca:** `personal.behind` e continuidade devem aparecer
6. **Verificar `visualWeight`:** cada grupo da timeline deve ter exatamente 1 evento `hero`, ≤4 `card`, resto `row`
7. **Performance:** endpoint v3 deve responder em < 2s com cache cold (checar com `console.time`)

---

## Restrições e decisões de arquitetura

- **Não quebrar a rota `/v2`** durante a transição — manter `AgendaV2CompatResponse` até migração completa
- **Não usar `useEffect` para fetch na page** — usar Server Components ou `use()` com Suspense sempre que possível
- **Cache strategy:** eventos de monitoramento prioritário → 5min; agenda global → 15min; personal → 10min
- **TMDB images:** sempre usar `https://image.tmdb.org/t/p/` com tamanho adequado ao contexto (`w780` para backdrop hero, `w342` para poster card, `w185` para poster row, `original` para logo transparente)
- **Sem bibliotecas de calendário externas** — construir o heatmap com CSS Grid nativo
- **Providers regionais BR:** IDs principais — Netflix `8`, Prime Video `119`, Disney+ `337`, Max `1899`, Globoplay `307`, Paramount+ `531`
- **Filtrar sempre:** `without_genres: "10767,10763,10764"` (talk show, notícias, reality) em todas as queries Discover

---

## Referência visual

A página deve se aproximar visualmente da Home POPLOG existente:
- Dark background com cards semi-transparentes (`bg-white/[0.04]`, `border-white/[0.08]`)
- Hierarquia visual clara: hero > seção pessoal > timeline > curadoria global
- Labels de seção em uppercase tracking (`text-xs font-semibold uppercase tracking-[0.2em]`)
- Cores de acento para tipos de evento: rose para pessoal, amber para cinema, emerald para streaming
- Imagens TMDB com `object-cover` e overlay gradiente sempre que usadas como background

---

## Arquivos que NÃO devem ser alterados neste rework

- `src/server/state/user-title-state.ts` — lógica de estado do usuário é externa à Agenda
- `src/server/cache/season-cache.ts` — cache de temporadas já funciona corretamente
- `src/server/api-clients/tmdb/client.ts` — cliente TMDB não muda
- `src/app/api/poplog3/agenda/route.ts` e `/v2/route.ts` — manter para compatibilidade
- `src/context/` — providers globais de estado não são escopo deste rework
