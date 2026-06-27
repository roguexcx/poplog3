# POPLOG — Diagnóstico e Walkthrough do Sistema

> Documento para **caminhar internamente** na engine: como os dados fluem, quais
> engines existem, como um título é resolvido, onde estão as coisas e o que vigiar.
> Complementa a fonte de verdade (`POPLOG_SYSTEM_OVERVIEW.md`) com uma leitura
> narrativa/navegável. Estado: 2026-06-26, branch `feature/sistema-novo`.
> Validação local mais recente: `regression:local` 22/22 + typecheck + lint verdes.

## Como ler este documento
1. **§1 Ciclo de uma requisição** — o mapa mental de ponta a ponta.
2. **§2 Identidade canônica** — o coração do sistema (resolva isto e o resto fecha).
3. **§3 Engines centrais** — os motores server-side e como conversam.
4. **§4 Cache em camadas** — memória → DB → Redis, e quando cada uma entra.
5. **§5 i18n (3 eixos)** — interface, catálogo, região; adoção real e o bloqueio.
6. **§6 Caminho de dados por módulo** — Home, título, busca, biblioteca, etc.
7. **§7 Pontos de diagnóstico/saúde** — gargalos, riscos, o que monitorar.
8. **§8 Achados desta rodada** — `<img>`, i18n, logs (com recomendação).
9. **§9 Mapa do código** — onde está o quê.

---

## 1. Ciclo de uma requisição (request lifecycle)

POPLOG é **POPLOG-first**: o banco/cache local é a primeira fonte; a rede externa
só entra quando falta dado ou ele venceu. O fluxo típico de uma página de catálogo:

```
URL (ex.: /the-wolf-of-wall-street-2013  ou  /title/movie/tt0993846)
  │
  ├─ app/[slug]/page.tsx (Server Component, SSR)
  │     └─ resolve slug → identidade canônica (poplogId/imdbId)
  │
  ├─ server/titles/get-title-page-data.ts  (orquestrador da página)
  │     ├─ DB-first: poplog3Title + season/episode + translations + assets
  │     ├─ se frio/vencido → engines externas (Trakt/Balloonerismm) e PERSISTE
  │     ├─ availability (camada global) anexa best_provider_* por região
  │     └─ serializa o contrato da página (title/overview/seasons/providers/cast…)
  │
  └─ render server-side → HTML; o cliente hidrata só as ilhas interativas
        (TitleActions, TitleEpisodeBrowser) que chamam /api/* quando o user age
```

Princípios que se repetem em todo fluxo:
- **Leitura**: cache de memória → DB persistente → (Redis se ligado) → rede externa.
- **Escrita de estado do usuário**: grava na tabela transacional e **materializa**
  `UserTitleState` via `upsertTitleState()` (engine de estado).
- **Fallback rotulado**: toda resposta de catálogo carrega a origem real
  (`realness`, `source`, `cacheStatus`) — o fallback nunca se disfarça de fresco.

## 2. Identidade canônica (o coração)

Resolva isto e o resto do sistema fica legível. Todo título tem uma identidade
**IMDb-first**:

```
imdbId  (canônico quando existe)
  └─ resolvePoplogIdentity / resolvePoplogTitleIdentity
        → poplogId  (chave interna estável que a UI usa)
        → aliases: tmdbId (sintético), traktId, tvdbId, slug
```

- `imdbId` é a verdade. Quando um título não tem TMDB positivo, gera-se um
  **tmdbId sintético** estável a partir do imdbId (`lib/ids/synthetic-tmdb-id.ts`,
  round-trip determinístico). Isso permite que código legado que pensa em "tmdbId"
  continue funcionando sem reintroduzir o TMDB como fonte.
- Modelos: `Poplog3Title` (canônico) + `TitleExternalId` + `TitleSourceIdentity` +
  `TitleAlias` + `UserLibraryIdentity`.
- **URLs**: a forma pública canônica é o **slug** (`/[slug]`). Rotas antigas por id
  (`/title/movie/tt…`) redirecionam 308 para o slug. Pessoa: `/person/[id]`
  (`/pessoa/[id]` é redirect legado).
- **Por que importa no diagnóstico**: 90% dos bugs de "título errado/duplicado"
  nascem de identidade mal resolvida. Sempre comece perguntando "qual é o imdbId e o
  poplogId aqui?".

## 3. Engines centrais (os motores)

Cada engine é server-side, isolada, e DB-first. As cinco que importam:

### 3.1 Source-engine — `server/source-engine/`
O motor de **catálogo/busca**. Recebe `query`/`id` + `language`/`region`, resolve via
adapters externos (Balloonerismm primário, Trakt fallback), **hidrata** contra o DB
(`hydrate-catalog-results.ts`), normaliza identidade e devolve itens POPLOG. É quem
a busca (`/api/search`) e o discover usam. Ponto de entrada: `engine.ts`
(`catalogSearch`, `catalogGetPopular`, `catalogGetByGenre`, `catalogSearchCompanies`).

### 3.2 Availability — `server/availability/`
Camada **global única** de "onde assistir". Banco-first com estado negativo e stale:
1. cache `CatalogAvailability` por `imdbId+region+language`;
2. fresco → retorna; stale dentro de `staleUntil` → retorna e **enfileira refresh**;
3. senão → JustWatch/Balloonerismm ao vivo, normaliza, persiste;
4. nunca devolve "indisponível" falso — em falha serve cache/stale.
Consumida por Biblioteca, Home, Busca, Título e Sorteio via
`getTitleAvailability`/`hydrateManyTitleAvailability` + `attach-best-provider`.

### 3.3 Estado do usuário — `server/state/` + `server/library/`
Padrão **CQRS**: `UserTitle` (transacional, o que o user declarou) é a escrita;
`UserTitleState` (materializado) é a leitura. Toda escrita passa por
`upsertTitleState()`, que recomputa progresso de série, franquia e estado visual
(`computedState`: watchlist/in_progress/up_to_date/completed/watched/abandoned/fridge).
**Verificado nesta auditoria**: a propagação está no lugar (library-service,
episode-progress e o reopen de continuity chamam o materializador). Não há mais o
gap de dual-write que o `ARCHITECTURE.md` antigo descrevia.

### 3.4 Trending — `lib/trending/` + `lib/trakt-index/`
Termômetro vivo. Fonte única `getTrendingFeed()`: Trakt Index (7 sinais) → adapter
Trakt → DB local. Sem TMDB. Ranking com boost de recência e damp de catálogo antigo
sem spike. Índice **bilíngue** (pt-BR + en-US no mesmo payload) — a projeção por
idioma acontece na leitura. Alimenta Home, Hero, "Em alta" e a descoberta.

### 3.5 Continuity / Recomendações / Radar
- **Continuity** (`server/continuity/` + `/api/continuity/*`): Hero personalizado,
  "continuar", novos episódios, watchlist viva — tudo lendo `UserTitleState`.
- **Recomendações** (`server/recommendations/`): RRF (k=60) combinando Balloonerismm
  + Trakt, com política editorial. Superfícies: "Mais como este" (título) e "Para
  Você" (`/api/user/for-you`).
- **Radar** (`server/radar-trakt/` + `/api/radar`): Trakt Calendar como estrutura,
  enriquecido localmente; payload V2 (`sections`/`filters`/`stats`).

## 4. Cache em camadas (e quando cada uma entra)

Três camadas substituíveis — nenhuma é dependência obrigatória de render:

```
1) Memória / proc-cache  → dedup in-flight, TTL curto, LRU (ex.: hero route)
2) DB persistente (MySQL) → fonte canônica: poplog3Title, CatalogAvailability,
                            ContinuitySectionCache, PoplogSearchCache, caches de
                            people/credits/financials, IcsAgendaCache
3) Redis (opcional, REDIS_URL) → acelera chaves quentes; ausência degrada com graça
```

**Regra de ouro**: a chave inclui idioma e/ou região quando isso muda o resultado.
Exemplos: `title:{imdbId}:{lang}:{region}`, `search:{q}:{lang}:{region}`,
`providers:{imdbId}:{region}:{lang}`, `radar:{mode}:{lang}:{region}:{version}`.
Exceção intencional: o índice de trending é **bilíngue de propósito** (um payload
com pt-BR+en-US) — a projeção por idioma é na leitura, então não contamina.

**Diagnóstico**: cache de um idioma/região **nunca** deve sobrescrever outro. Se
"apareceu pt-BR no en-US", suspeite de chave de cache sem o eixo de idioma.

## 5. Internacionalização — três eixos (e o bloqueio real)

```
interfaceLanguage  → UI (uiMessage(), generated-ui-messages.json — 953 chaves)
catalogLanguage    → metadados do catálogo (lib/i18n/catalog-localization.ts)
availabilityRegion → providers/disponibilidade (camada global)
```

**Não misture os três.** A interface pode estar em pt-BR enquanto o catálogo está em
en-US e a disponibilidade em BR — são preferências independentes
(`UserCuradoriaPreference` + cookies `poplog_*`).

**Estado de adoção de catálogo — CONCLUÍDO site-wide (2026-06-27):**
- ✅ **Armazenamento bilíngue**: `CatalogLocalization` / `catalog_localizations`
  (migration `00000000000018`, chave `(poplogId, language)`, guarda title/overview/
  tagline por idioma). Isso resolveu o pré-requisito de dados que antes bloqueava.
- ✅ **Resolver canônico**: `resolveCatalogLocalization` (`lib/i18n/catalog-localization.ts`),
  com store em `server/catalog/catalog-localization-store.ts`.
- ✅ **Integrado**: Home/Trending, página de título, Radar, Busca, Sorteio (+ Para
  Você/Watchlist de antes).

**Fallback explícito e rastreável** (a função **nunca traduz** — só escolhe entre
textos recebidos das fontes): (1) `catalogLanguage` pedido → (2) outro idioma
(pt-BR↔en-US) → (3) idioma do legado `overviewLanguage` → (4) primeiro bloco com
texto → (5) campos legados do título. Cada resolução retorna `fallbackUsed`/
`fallbackLanguage`/`requestedLanguage` (telemetria). Validado por
`smoke:catalog-localization` (pt-BR exato, en-US exato, e fallback pt-BR→en-US
quando só há en-US).

## 6. Caminho de dados por módulo (mapa rápido)

| Módulo | Rota/entrada | Fonte → fallback | Lê de | Cache |
|---|---|---|---|---|
| Home/Trending | `features/home`, `getTrendingFeed` | Trakt Index → Trakt → DB | índice bilíngue | `home_trending*` 30min |
| Hero/Continuar | `/api/continuity/*` | DB (`UserTitleState`) | estado materializado | LRU + section-cache |
| Busca leve | `/api/search` | source-engine (Balloon→Trakt) | DB hidratado | `search:*` |
| Busca rica | `/api/search?include=people,companies` | + searchEntities + companies | idem | idem |
| Página de título | `get-title-page-data.ts` (SSR) | Balloon→Trakt; TVDB/Trakt p/ eps | DB-first | section-cache 6h |
| Providers | `/api/providers` + camada availability | JustWatch/Balloon | `CatalogAvailability` | TTL + estado negativo |
| Biblioteca | `server/library` | DB (`UserTitleState`) | estado | — |
| Para Você | `/api/user/for-you` | RRF Balloon+Trakt | DB + pool | por user+lang+region |
| Radar | `/api/radar` | Trakt Calendar | DB enriquecido | `radar_trakt:*` v3 |
| Sorteio | `server/sorteio` | DB/cache (sem externo no draw) | pool local | seed mínimo |
| Acompanhando | `/api/acompanhando` | DB (`UserTitleState`) | estado | — |
| Admin | `/api/admin/*` | DB + engine logger | tudo | — |

> Todas as rotas de API são **bare `/api/*`** — o namespace legado `/api/poplog3/*`
> foi removido por completo nesta auditoria.

## 7. Pontos de diagnóstico / saúde (o que vigiar)

- **Fan-out da página de título** é a maior superfície de latência: pode disparar
  Balloonerismm + Trakt + TVDB + Wikidata/Wikipedia numa render fria. Mitigado por
  DB-first + caches longos + stubs de série + hidratação por worker. Se a página
  fria ficar lenta, é aqui que se olha.
- **Para Você** é o maior volume de chamadas externas (até ~12 seeds × 2 endpoints
  Balloonerismm). Mitigado por dedup in-flight + cooldown por path + pool cache.
- **TVDB** era o gargalo de quota (free 250 req/mês); o client standalone foi
  removido — episódios vêm de Trakt + Balloonerismm. `tvdbId`/`still_source='tvdb'`
  permanecem só como aliases/registro histórico.
- **Workers/fila** (`PoplogRefreshQueue`): se disponibilidade stale não atualiza,
  verifique o worker (`workers:refresh`) e o cron (`/api/cron/refresh-workers`).
- **Cache cross-idioma**: "pt-BR no en-US" = chave sem eixo de idioma (ver §4/§5).
- **Identidade**: títulos duplicados/errados = `resolvePoplogIdentity` (ver §2).
- **Engine logger** (`server/engine-logger`): TODAS as chamadas (api, op, endpoint,
  cacheStatus, duração) são logadas → aba **Engine**/**API** do Admin. É o primeiro
  lugar para diagnosticar latência/origem de qualquer dado.

**Tabelas a observar (saúde do banco):** `CatalogAvailability` (disponibilidade
canônica), `UserTitleState` (estado materializado — fonte de leitura), `Poplog3Title`
(catálogo), `PoplogRefreshQueue` (fila). Três tabelas mortas foram dropadas nesta
auditoria (`UserWatching`, `Poplog3TitleAvailability`, `Poplog3AvailabilityFallbackState`).

## 8. Achados desta rodada (decisões técnicas)

### 8.1 `<img>` vs `next/image` — decisão: manter `<img>`
`next.config.ts` usa **`images.unoptimized = true`** e **todas** as imagens externas
passam pelo proxy `/api/images/proxy` (decisão arquitetural explícita no config).
Sob `unoptimized`, `next/image` **não otimiza nada** — não há ganho de LCP/banda — e
ainda exigiria allowlist de domínios, com risco de erro em runtime. `SourceLogo.tsx`
já tratava o `<img>` intencional com `eslint-disable` por linha. **Resolução**: a
regra `@next/next/no-img-element` foi **desligada de forma documentada** em
`eslint.config.mjs` (reflete a arquitetura real), em vez de uma conversão cega sem
ganho. *Se* um dia quiserem otimização real de imagem, o caminho é um projeto à
parte: remover `unoptimized`, configurar o optimizer e medir — com validação visual.

### 8.2 i18n de catálogo site-wide — bloqueado em pré-requisito de dados
Ver §5: depende de materializar overview bilíngue (schema + worker) antes de adotar
`pickLocalized` nos serializers. Não foi forçado às cegas; está documentado como o
próximo projeto de i18n com ordem segura.

### 8.3 Logs/markers — política aplicada
Removidos os **4 `console.log` de cliente** (debug ruidoso). Os ~131 logs server
restantes são, na maioria, **telemetria estruturada** (`[ENGINE]`, `[availability]`,
`[trending/telemetry]`) e ficam — existe `server/logging/logger.ts` para padronizar
nível quando quiserem. Os ~191 markers `legacy/legado` são em sua maioria **rótulos
de compat intencionais** (source tags, aliases de fallback), não código morto: não é
mass-delete; revisar só os ~47 que estão em comentário quanto a precisão.

## 9. Mapa do código (onde está o quê)

```
src/
  app/                 rotas + layouts (App Router); SSR fino, sem regra pesada
    api/               TODAS as APIs em bare /api/* (sem poplog3)
    [slug]/            página de título canônica
    admin/             painel + tabs (catalog, users, radar, workers, engine, API)
  features/            experiência por domínio (home, title, search, library,
                       lists, for-you, acompanhando) — UI + hooks de domínio
  components/          UI global atômica (cards, hero, skeletons, ui, attribution)
  server/              MOTORES server-side:
    source-engine/     catálogo/busca   availability/   onde assistir
    state/ library/    estado do user   continuity/     hero/continuar
    recommendations/   RRF              radar-trakt/     radar
    titles/            página de título  repositories/   acesso a banco
    search/            rich-search-handler  workers/      fila de refresh
    api-clients/       balloonerismm, trakt, wikidata, wikipedia (vivos)
    logging/ engine-logger/  observabilidade
  lib/                 utilitários puros: i18n, ids, images, seo, trending,
                       trakt-index, personalization, legal
  stores/ hooks/ context/   estado de UI (zustand) e hooks compartilhados
prisma/schema.prisma   43 models (MySQL)
docs/                  POPLOG_SYSTEM_OVERVIEW (verdade) + architecture/ (planos +
                       este diagnóstico) + modules/ operations/ production/
```

## 10. Para onde caminhar a seguir (backlog priorizado)
1. **i18n de catálogo** (§5): schema overview bilíngue → worker → serializers. Maior
   valor de produto pendente.
2. **Otimização de imagem** (§8.1): decisão de produto — só se quiserem sair do
   `unoptimized`. Passada visual dedicada.
3. **Remoção dos rótulos legacy/comentários** desatualizados (§8.3) — higiene leve.
4. **Produção** (Hostinger): banco/Redis gerenciados, CDN, cron real — ver
   `production/`. Nada estrutural bloqueia; é trabalho de ambiente.

> Saúde geral: arquitetura coerente e unificada, identidade IMDb-first, um único
> namespace de API, estado materializado consistente, três tabelas mortas removidas,
> e `regression:local` 22/22. A base está pronta para evoluir produto, não para
> apagar incêndio estrutural.
