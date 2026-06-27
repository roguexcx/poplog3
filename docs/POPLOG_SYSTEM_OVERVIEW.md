# POPLOG — Visão Geral do Sistema (Fonte de Verdade)

> Documento mestre do POPLOG. Descreve o **estado real do código** em
> 2026-06-26 (branch `feature/sistema-novo`), não planos antigos nem desejos.
> Substitui `POPLOG_V2_SYSTEM_OVERVIEW.md` e `ARCHITECTURE.md` (ambos
> removidos do repo — histórico no git; o segundo estava desatualizado). Pendências e ordem de migração:
> `architecture/POPLOG_GLOBAL_UNIFICATION_PLAN.md`. Fechamento consolidado
> (removido/migrado/validado/backlog): `architecture/POPLOG_UNIFICATION_CLOSEOUT.md`.
> Walkthrough/diagnóstico navegável da engine: `POPLOG_SYSTEM_DIAGNOSTIC.md`.

## 1. Visão geral

POPLOG é um indexador/curador de catálogo de filmes e séries (não hospeda nem
distribui mídia — ver `legal/DISCLAIMER.md`). É uma aplicação **Next.js (App
Router) + TypeScript**, com **Prisma sobre MySQL**, autenticação **NextAuth**,
estado de UI com **Zustand**, estilo **Tailwind** e animação **framer-motion**.

Princípio operacional central: **POPLOG-first / IMDb-first**. As APIs externas
identificam e renovam dados; o POPLOG lê preferencialmente do banco/cache local e
só chama a rede quando o dado está ausente ou vencido. A identidade canônica do
catálogo é o **IMDb ID**; demais IDs (Trakt, TMDB sintético, TVDB, Wikidata) são
aliases.

Ambiente atual: **local** (localhost, Docker, MySQL local, storage local, Redis
opcional). Hostinger/produção é destino futuro, não ambiente ativo.

Escala do código: ~536 arquivos `.ts/.tsx` (~97k linhas), ~90 rotas de API, 25
páginas, 44 modelos Prisma (migrations `00000000000000`–`00000000000018`).

## 2. Princípios arquiteturais

1. **Uma fonte de verdade por domínio.** Catálogo → `Poplog3Title`; estado do
   usuário → `UserTitleState` (materializado); disponibilidade → camada global de
   availability; trending → Trakt Index bilíngue.
2. **IMDb-first.** `imdbId` é a identidade canônica; `poplogId` resolve a partir
   dele. `tmdbId` é alias sintético (round-trip estável via
   `lib/ids/synthetic-tmdb-id.ts`).
3. **Separação de camadas.** `app/` (rotas/HTTP) · `features/` (experiência por
   área) · `server/` (regras de domínio, integrações, cache, workers, persistência)
   · `lib/` (utilitários puros: i18n, SEO, imagens, ids, legal) · `components/` (UI).
4. **Idioma e região são conceitos separados** (ver §6): `interfaceLanguage`,
   `catalogLanguage`, `availabilityRegion`. Cache sempre considera idioma/região
   quando isso altera o resultado.
5. **Fallback explícito e rotulado.** Toda resposta de catálogo/trending carrega a
   origem real (`realness: trending | fallback_local`, `source`, `cacheStatus`); o
   fallback nunca se disfarça de dado fresco e nunca sobrescreve dado melhor.
6. **Componentes visuais sem regra pesada de negócio**; engines server-side
   isoladas; repositories para acesso a banco; serializers para contratos de API.

## 3. Identidade de catálogo

| Conceito | Onde | Papel |
|---|---|---|
| `imdbId` | `Poplog3Title.imdbId`, `TitleExternalId` | **Identidade canônica** quando existe |
| `poplogId` | resolvido por `resolvePoplogIdentity` | chave interna estável da UI |
| `tmdbId` | `lib/ids/synthetic-tmdb-id.ts` | alias; sintético derivado de imdbId p/ títulos sem TMDB positivo |
| `traktId` | `TitleExternalId` | alias de descoberta/enriquecimento |
| `tvdbId` | `TitleExternalId` | alias; usado no merge canônico de episódios (still_source) |
| `slug` | `Poplog3Title.slug` | URL pública limpa (`/[slug]`) |

Modelos de identidade: `Poplog3Title` (canônico), `TitleExternalId`,
`TitleSourceIdentity`, `TitleAlias`, `UserLibraryIdentity`. Rotas antigas baseadas
em TMDB (`/title/movie/{imdbId}`) redirecionam 308 para a URL canônica por slug.

## 4. Páginas (App Router) — `src/app`

| Rota | Página | Estado |
|---|---|---|
| `/` | Home (Hero rotativo, Trending "Em alta", Para Você, Watchlist viva) | ativa |
| `/[slug]` | Página de título por slug canônico | ativa |
| `/title/[mediaType]/[id]` | Título por id (redireciona p/ slug) | ativa (compat) |
| `/buscar` | Busca global | ativa |
| `/radar` | Radar V2 (calendário/estreias) | ativa |
| `/library` | Biblioteca | ativa |
| `/para-voce` | Para Você | ativa |
| `/acompanhando` | Acompanhando (continuidade) | ativa (lógica legada, ver plano) |
| `/sorteio` | Sorteio | ativa |
| `/person/[id]` | Página de pessoa | ativa (canônica) |
| `/pessoa/[id]` | — | **redirect 308 → /person/[id]** (legado) |
| `/agenda` | — | **redirect → /radar** (compat; módulo morto removido) |
| `/filmes`, `/series`, `/generos/[media]/[id]`, `/franquia/[id]`, `/network/[slug]`, `/estudio/[kind]/[id]` | Catálogo/descoberta | ativas |
| `/u/[username]/listas/[handle]` | Lista pública de usuário | ativa |
| `/profile`, `/settings` | Conta | ativas |
| `/legal` | Termos/Disclaimer | ativa |
| `/admin` | Painel admin (abas: catálogo, usuários, Radar, workers, engine, operações) | ativa |
| `/debug/{apis,engine,radar}` | — | **removidas**; consolidadas no Admin (abas API/engine/radar) |

## 5. Módulos e fluxos

- **Home / Trending / Hero / Em Alta** (`features/home`, `lib/trending`,
  `getTrendingFeed()`): fonte única Trakt Index (7 sinais) → Trakt adapter → DB
  local. Sem TMDB. Ranking "termômetro vivo" com boost de recência e damp de
  catálogo antigo sem spike. Detalhe em `modules/TRENDING.md`.
- **Busca** (`/api/search`, `/api/poplog3/search`, `server/poplog-search`,
  `server/source-engine`): títulos via Balloonerismm `/search/multi` → Trakt
  fallback; pessoas/empresas via Balloonerismm. Hook client
  `useDebouncedGlobalSearch` (debounce, abort, cache curto, ordem garantida).
  **Duas rotas coexistem** (ver plano).
- **Página de título** (`server/titles/get-title-page-data.ts`): maior fan-out —
  detalhes (Balloonerismm → Trakt), temporadas/episódios (engine canônica Trakt +
  merge, Balloonerismm fallback), providers (camada global), financeiro
  (Balloonerismm → DB → Wikidata → Wikipedia), ratings, related, trailers,
  comentários (Trakt). DB-first com caches longos.
- **Biblioteca / Para Você** (`server/library`, `features/library`,
  `/api/user/for-you`): leem `UserTitleState`; Para Você usa RRF
  (Balloonerismm + Trakt) com cache por `catalogLanguage`+`region`+biblioteca
  (**sem** `interfaceLanguage` na chave — pool guarda dados neutros). Detalhe em
  `modules/RECOMMENDATIONS.md`.
- **Radar** (`server/radar-trakt`, `/api/radar`, `RadarV2Client.tsx`): Trakt
  Calendar como fonte estrutural; enriquecimento local IMDb/locale/assets. Payload
  V2 (`sections`, `filters`, `stats`); blocos Para mim/Acompanhando/Hoje/Semana/Em
  breve/Descoberta. Detalhe em `modules/RADAR.md`.
- **Sorteio** (`server/sorteio`): pool banco/cache-first no draw, sem chamada
  externa síncrona; seed mínimo pós-reset garante pool não-vazio.
- **Listas** (`server/lists`, `/api/lists`): 100% DB local. Detalhe em
  `modules/LISTS.md`.
- **Admin** (`app/admin`, `/api/admin`): catálogo, overrides+rollback granulares
  (campo/idioma/região), usuários (role user/admin/master, block/reactivate),
  cache, assets, fila de workers, aba Operações consolidada, auditoria
  (`AdminActionLog`).
- **Legal/consentimento** (`lib/legal`, `components/legal/ConsentBanner`,
  `/api/legal/consent`, modelo `UserLegalConsent`): banner LGPD/cookies,
  persistência em `localStorage` (anônimo) e banco (logado).
- **Agenda**: módulo legado **removido** (engine, feature e `/api/poplog3/agenda*`). O redirect `/agenda`→`/radar` foi mantido para compatibilidade; o Radar é o sucessor.

## 6. Internacionalização — três conceitos separados

```txt
interfaceLanguage  = idioma da interface (botões, labels, mensagens)
catalogLanguage    = idioma dos metadados do catálogo (título, sinopse, tagline)
availabilityRegion = região de disponibilidade (providers, janelas)
```

- Persistência: `UserCuradoriaPreference` (logado) + cookies
  `poplog_interface_language`, `poplog_catalog_language`, `poplog_region` (anônimo).
  Seletor fixo no footer. API `/api/user/locale`.
- **Interface**: 839 mensagens externalizadas em
  `lib/i18n/generated-ui-messages.json` (pt-BR/en-US), renderizadas por
  `uiMessage()`. Auditoria `audit:i18n --fail-on-hardcoded` = 0 hardcoded nos
  arquivos de interface.
- **Catálogo**: `lib/i18n/catalog-localization.ts` (`CatalogLocalized`,
  `pickLocalized`) — cada item guarda as versões recebidas das fontes por idioma; a
  UI escolhe a versão por `catalogLanguage` com fallback explícito. **Não há
  tradução manual de metadados.** Traduções editoriais ficam em `TitleTranslation`.
- **Estado de adoção (CONCLUÍDO — site-wide):** o armazenamento bilíngue vive em
  `CatalogLocalization` (`catalog_localizations`, migration `00000000000018`, chave
  única `(poplogId, language)`, guarda `title`/`overview`/`tagline` por idioma). O
  resolver canônico `resolveCatalogLocalization` (`lib/i18n/catalog-localization.ts`)
  escolhe a versão por `catalogLanguage` com **fallback explícito e rastreável**
  (`fallbackUsed`/`fallbackLanguage`/`requestedLanguage`) e **nunca traduz**. Integrado
  em Home/Trending, página de título, Radar, Busca e Sorteio (além de Para Você/
  Watchlist). Leitura/hidratação via `server/catalog/catalog-localization-store.ts`.
- **"Para Você" respeita a separação (2026-06-27):** o motor de recomendação produz
  `ForYouReasonData` (dados neutros: `reasonCode`, `seedTitle`, `moreCount`,
  `genrePrefix`) em vez de strings finais. A frase de UI é montada na borda —
  no client via `useLocale().ui` ou no servidor via `uiMessageFor(interfaceLanguage)`
  — usando o `interfaceLanguage` **corrente no momento da renderização**.
  `seedTitle`/`genrePrefix` são metadados de catálogo (`catalogLanguage`), não UI.
  Trocar o idioma de interface re-renderiza textos sem refazer o fetch pesado;
  trocar `catalogLanguage` ou `region` invalida o pool e dispara nova recomendação.
  Helper compartilhado: `src/lib/for-you/reason.ts` (`renderForYouReason`,
  `renderForYouMediaLabel`). Chaves i18n: `for_you.reason.*`, `for_you.media.*`.
- **Troca de idioma fluida — sem reload (2026-06-27):** `saveLocale()` em
  `LocaleContext` faz PATCH `/api/user/locale` (persiste no DB + seta cookies via
  `Set-Cookie`) e chama `setLocaleState()` internamente. Todos os componentes com
  `useLocale()` re-renderizam imediatamente via contexto React. `applyLocaleToDocument()`
  atualiza `document.documentElement.lang` / `data-*` client-side.
  `window.location.reload()` que existia em `LocaleFooterSwitch` e
  `ProfilePageClient` foi removido — era completamente redundante e causava F5
  visual desnecessário. **Regra**: nunca chamar `reload()` ou `router.refresh()`
  após `saveLocale()` — o contexto já propaga a mudança para todos os consumers.
  Componentes que dependem de `catalogLanguage`/`region` (ex: `ForYouSection`)
  re-disparam seus fetches via `useEffect` deps, sem reload.

## 7. APIs internas (App Router) — destaques

- Catálogo/leitura: `/api/trending`, `/api/search`, `/api/poplog3/search`,
  `/api/title/[mediaType]/[id]`, `/api/poplog3/titles/[mediaType]/[id]`,
  `/api/poplog3/providers`, `/api/poplog3/episodes`,
  `/api/poplog3/tv/[id]/seasons/[season]`, `/api/radar`, `/api/discover`,
  `/api/poplog3/discover`.
- Continuidade/Acompanhando: `/api/poplog3/continuity/{hero,continue,new-episodes,
  recently-watched,upcoming-episodes,watchlist-picks}`, `/api/poplog3/acompanhando`.
- Usuário/biblioteca: `/api/library`, `/api/library/title`, `/api/watchlist/live`,
  `/api/lists/*`, `/api/ratings`, `/api/user/{for-you,feedback,locale,
  streaming-preferences,genre-stats,not-interested,reset-library}`.
- Sistema: `/api/auth/*`, `/api/legal/consent`, `/api/og/*`, `/api/images/proxy`,
  `/api/storage/[...path]`, `/api/cron/refresh-workers`, `/api/admin/*`,
  `/api/debug/{health,config,engine}`.

**Contratos versionados**: Trending expõe `TrendingV2Response`; Radar expõe
`RadarPayload` V2 (compat legada atrás de `legacy=1` só no endpoint).
**Namespace canônico:** o público é o bare `/api/*`; `/api/poplog3/*` é o namespace **legado**, mantido como adapter de compat (período de redirect por delegação, não HTTP 308 — preserva método/corpo). Título e discover já têm o canônico no bare (poplog3 delega). Busca segue como dois tiers intencionais (`/api/search` rápido vs `/api/poplog3/search` rico). Backlog das demais rotas poplog3: ver plano §11.
unificação de rotas.

## 8. APIs externas

| Fonte | Client | Papel | Flag |
|---|---|---|---|
| **Balloonerismm** (atribuído como JustWatch) | `api-clients/balloonerismm/client.ts` | Fonte primária: catálogo, busca, pessoas, episódios (fallback), **providers**, recomendações | `BALLOONERISMM_ACTIVE` |
| **Trakt.tv** | `api-clients/trakt/client.ts` | Canônico/fallback de catálogo, **trending index**, **Radar calendar**, traduções pt-BR, comentários | `TRAKT_ACTIVE`, `TRAKT_INDEX_ENABLED` |
| **Wikidata** | `api-clients/wikidata/client.ts` | Financeiro (orçamento/bilheteria) por IMDb | automático |
| **Wikipedia** | `api-clients/wikipedia/client.ts` | Fallback financeiro (infobox) | automático |

**Removidos** (não são mais clients HTTP): TMDB (resta `tmdb/types.ts` só p/ id
sintético + paths de imagem persistidos), **OMDb** e **TheTVDB** (clients
deletados). `tvdbId` e `still_source='tvdb'` permanecem como aliases/registro
histórico no merge canônico de episódios. Watchmode e Movie of the Night: fora.

Atribuição legal exibida ao usuário (`attribution/api-sources.ts`) corrigida nesta
rodada para listar só Trakt e JustWatch. Wikidata/Wikipedia ainda não creditados na
UI (pendência no plano).

## 9. Banco de dados (MySQL via Prisma — 44 modelos)

Domínios principais:

- **Catálogo/identidade**: `Poplog3Title`, `TitleExternalId`,
  `TitleSourceIdentity`, `TitleAlias`, `TitleTranslation`, `CatalogLocalization`,
  `TitleSeason`,
  `Poplog3Episode`, `TitleAsset`, `TitleOverride`, `UserLibraryIdentity`.
- **Estado do usuário**: `UserTitleState` (materializado, fonte de verdade de
  leitura), `UserTitle` (transacional), `UserEpisode`, `UserWatching`,
  `UserRating`, `UserTitleFeedback`, `UserCuradoriaState`, `UserCuradoriaSignal`,
  `UserCuradoriaPreference`, `UserList`, `UserListItem`, `UserEvent`,
  `HeroSpotlightSession`, `UserLegalConsent`.
- **Disponibilidade**: `Poplog3TitleAvailability`, `CatalogAvailability`,
  `Poplog3AvailabilityFallbackState`, `StreamingProvider`,
  `UserStreamingPreference`.
- **Cache persistente**: `ContinuitySectionCache`, `PoplogSearchCache`,
  `PoplogPeopleCache`, `PoplogPersonCreditsCache`, `PoplogTitleFinancialsCache`,
  `IcsAgendaCache`.
- **Ratings públicos**: `TitleRating`, `RatingAggregate`.
- **Operação**: `PoplogRefreshQueue` (fila de workers), `EngineApiCallLog`,
  `ApiUsageDaily`, `Poplog3PremiumApiUsage`, `AdminActionLog`.
- **Auth**: `User`, `Account`, `Session`, `VerificationToken`.

**Pontos de atenção (Fase 4 — detalhe no plano §13):** `CatalogAvailability` (imdbId-first) é a tabela de disponibilidade canônica; `Poplog3TitleAvailability` (tmdbId, sem escritas) e `Poplog3AvailabilityFallbackState` (sem refs) são mortas e devem ser dropadas. No estado do usuário, `UserTitle`+`UserTitleState` é split CQRS intencional com materialização já propagada; `UserWatching` é morta (só limpa no reset); `UserCuradoriaState` é viva (concern separado).

## 10. Cache

Camadas substituíveis (nunca dependência obrigatória de render): memória/proc-cache
→ banco persistente → Redis opcional (`REDIS_URL`). Padrão de chave inclui
idioma/região quando altera o resultado:

```txt
title:{imdbId}:{language}:{region}
search:{query}:{language}:{region}
providers:{imdbId}:{region}:{language}
radar:{mode}:{language}:{region}:{version}
home_trending / home_trending_local (real vs fallback, por idioma/região)
trakt_index_top50_daily_{versão}   (bilíngue, exceção intencional)
sorteio:{user}:{language}:{region}
```

Regra: cache de um idioma/região não sobrescreve outro. Reset oficial de trending
(`resetPoplogTrendingCaches`) limpa famílias real e local em MySQL e Redis.

## 11. Workers e cron

Fila persistente `PoplogRefreshQueue` com claim/lock/retry/complete/fail. Jobs:
`title`, `assets`, `availability`, `series-episodes`, `radar`. Worker executável
(`workers:refresh`), endpoint protegido `/api/cron/refresh-workers` (Bearer),
heartbeat em `AdminActionLog`, workflow agendado
`.github/workflows/poplog-worker-cron.yml` (a cada 5 min quando `POPLOG_CRON_URL`/
`POPLOG_CRON_SECRET` configurados). Aba Admin de workers monitora atraso/travamento.

## 12. Providers / disponibilidade

Camada global única (`server/availability/availability-service.ts`) consumida por
Biblioteca, Home, Busca, Título e Sorteio. Banco-first:

1. cache local por `imdbId + region + language` (inclui estado negativo);
2. se fresco → retorna; se stale dentro de `staleUntil` → retorna e agenda refresh;
3. senão chama Balloonerismm/JustWatch, normaliza, salva e retorna;
4. fallback residual com TTL menor.

Normalização comercial por fixtures (assinatura, canal adicional, aluguel, compra,
grátis, anúncios, cinema, indisponível). Cinema = status/janela, não provider
comercial artificial.

## 13. UX e design

Identidade visual escura (cards, hero, grid), `framer-motion` para transições,
skeletons (`components/skeletons/MediaGridSkeleton`), estados vazios e de erro.
Busca instantânea com debounce/abort. Progresso de séries refinado (marcar
lançados/temporada/até T-E, navegador de episódios com proteção contra saltos).
SEO de título com canonical por slug, metadata localizada, Open Graph/Twitter, OG
image dinâmica e JSON-LD (`Movie`/`TVSeries`). Pendências de consistência visual
estão no plano de unificação (§UX).

## 14. Performance

- Banco-first reduz chamadas externas; TTLs por tipo de dado; refresh em background
  com limite de concorrência.
- Primeira visita fria de série monta stubs e agenda hidratação por worker em vez
  de bloquear a render.
- Medições locais de referência (última rodada): Home ~120–230 ms, Trending
  ~90 ms, Busca ~70–210 ms, Providers (live) ~250–500 ms, Radar ~10–40 ms, Para
  Você/Biblioteca poucos ms (cache quente). Maior risco de latência: fan-out da
  página de título e seeds do Para Você (mitigado por dedup/cooldown/pool).

## 15. Operação local

- Subir banco: `docker compose up -d mysql` (+ `redis`, `minio` opcionais).
- Schema: `npm run db:push` / `prisma migrate`. Usuário local: `npm run db:seed`.
- Dev: `npm run dev` (ou `npm run dev:clean` quando o manifesto do Next travar).
- Smokes/regressão: `npm run regression:local` (agregado) e dezenas de
  `db:smoke:*` por domínio. Detalhe em `operations/LOCAL_FULL_MODE.md` e
  `operations/LOCAL_REGRESSION_COVERAGE.md`.
- Backup/restore MySQL: `operations/BACKUP_RESTORE.md`.

## 16. Preparação para produção (futuro)

Local-first e portável. Storage por `assetKey` (driver `local` padrão, `s3`
opcional já validado contra MinIO). `.env.production.example` e checklists em
`production/`. Pendências externas: deploy Hostinger, banco/Redis gerenciados,
CDN/Object Storage final, pooler de conexão, ativação real do cron e de anúncios.
Monetização: base AdSense desligada por padrão, posições em
`monetization/ADS_PLACEMENT_PLAN.md`.

## 17. Pendências (estado real)

1. ✅ **Localização de catálogo site-wide — CONCLUÍDA.** `CatalogLocalization` +
   resolver canônico, integrada em Home/Trending, título, Radar, Busca e Sorteio (§6).
2. ✅ **Overview/sinopse bilíngue — resolvido:** `catalog_localizations` guarda as
   versões por idioma; fallback explícito no resolver.
3. **Estado do usuário:** materialização em `UserTitleState` já propagada nas escritas (verificado Fase 4); resta dropar a tabela morta `UserWatching` (plano §13.1). `UserTitle`+`UserTitleState` é split CQRS intencional.
   eliminar escrita client-side direta em `UserTitle` sem materializar estado.
4. **Rotas:** título, discover e continuity migrados ao bare canônico; busca = dois tiers intencionais; módulo Agenda removido. ✅
5. **Disponibilidade:** `CatalogAvailability` é a canônica; `Poplog3TitleAvailability` (0 escritas) e `Poplog3AvailabilityFallbackState` (0 refs) são mortas → drop documentado no plano §13.2.
6. **Páginas de debug** consolidadas no Admin (aba "API"); módulo **Agenda removido**. ✅
7. **Atribuição** de Wikidata/Wikipedia na UI.
8. **Ruído de logs** (135 `console.log`) e ~205 marcadores legacy a revisar.
9. Revisão editorial das traduções `en-US` automáticas; auditoria visual
   multi-browser real.

> Itens 3–7 têm ordem segura de execução, riscos e critérios de aceite em
> `architecture/POPLOG_GLOBAL_UNIFICATION_PLAN.md`.

## 18. Próximos passos recomendados

1. Executar a Fase 1 do plano de unificação (remoções seguras já iniciadas) e a
   adoção de `catalog-localization` na página de título e Home.
2. Consolidar rotas duplicadas atrás de um único contrato, com adapter de compat.
3. Convergir disponibilidade para uma tabela e estado de usuário para
   `UserTitleState`.
4. **Concluído:** módulo Agenda removido e páginas de debug consolidadas no Admin.
5. Reduzir ruído de logs e marcadores legacy; manter este documento atualizado a
   cada mudança estrutural.
