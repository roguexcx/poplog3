# POPLOG 3.0 — Guia Técnico Operacional

> Guia objetivo da arquitetura atual da POPLOG v3. Serve para entender e
> explorar o sistema manualmente sem precisar de IA. Atualizado depois
> da varredura final pós-reconstrução.

---

## 1. Visão Geral

A POPLOG v3 é uma reconstrução arquitetural completa da v2, rodando em
paralelo. A v2 segue online; nada na v3 toca o que a v2 usa. Todo o
esquema novo vive sob o prefixo `poplog3_*`.

A regra global da arquitetura:

```
API externa
  → src/server/api-clients     (TMDB / OMDb / Watchmode / MotN)
  → src/server/normalizers     (shape canônico POPLOG)
  → src/server/cache           (Supabase como cache canônico)
  → src/server/sync            (orquestração de cache miss + fallback)
  → APIs internas /api/poplog3/*
  → UI (RSC + client islands)
```

A UI **nunca** chama APIs externas. Sempre passa pela camada interna.

---

## 2. Stack

- Next.js 16 (App Router, RSC).
- TypeScript strict.
- Tailwind CSS v4.
- Supabase (Postgres + Auth + RLS).
- Bibliotecas externas mínimas: `lucide-react`, `@supabase/ssr`,
  `@supabase/supabase-js`.

---

## 3. Banco de Dados (Supabase, projeto `poplog`)

### Tabelas `poplog3_*` ativas

| Tabela | Propósito | Unique key |
| --- | --- | --- |
| `poplog3_titles` | Cache canônico de títulos TMDB | `(tmdb_id, media_type)` |
| `poplog3_title_external_ids` | imdb_id, tvdb_id, trakt_id, watchmode_id, motn_id | `(tmdb_id, media_type)` |
| `poplog3_title_ratings` | IMDb, RT, Metacritic, TMDB, POPLOG Score | `(tmdb_id, media_type)` |
| `poplog3_providers` | Catálogo cross-provider (Netflix, Prime, etc) | — |
| `poplog3_title_availability` | Disponibilidade por (título, provider, tipo, país, source) | `(tmdb_id, media_type, provider_name, availability_type, country, source)` |
| `poplog3_seasons` | Cache TMDB de temporadas | `(series_tmdb_id, season_number)` |
| `poplog3_episodes` | Cache TMDB de episódios | `(series_tmdb_id, season_number, episode_number)` |
| `poplog3_user_titles` | Estado pessoal por título (watchlist/watching/watched/abandoned/fridge + favorite + liked) | `(user_id, tmdb_id, media_type)` |
| `poplog3_user_episodes` | Progresso pessoal por episódio | `(user_id, series_tmdb_id, season_number, episode_number)` |

### Tabelas da v2 (preservadas, não tocadas)

`user_titles`, `episode_progress`, `user_title_feedback`,
`streaming_providers`, `title_external_ids`, `title_streaming_availability`,
`api_sync_logs`, `user_streaming_preferences`,
`streaming_availability_events`, `title_metadata_cache`.

### RLS

- `poplog3_titles`, `poplog3_title_external_ids`, `poplog3_title_ratings`,
  `poplog3_providers`, `poplog3_title_availability`, `poplog3_seasons`,
  `poplog3_episodes`: leitura pública (`USING true`), escrita somente
  service_role.
- `poplog3_user_titles`, `poplog3_user_episodes`: política "self" — cada
  usuário só vê/edita os próprios registros (`auth.uid() = user_id`).
- service_role: bypass total.

### Migrations versionadas no Supabase

Aplicadas via MCP, não há arquivos `.sql` locais no momento. As mais
recentes da reconstrução: `poplog3_foundation_core_tables`,
`add_poplog3_titles_last_synced_at`, `add_poplog3_title_release_runtime_fields`,
`poplog3_title_availability`, `poplog3_seasons_and_episodes`,
`poplog3_user_episodes`.

---

## 4. Camada Server (`src/server/`)

### api-clients

Cada serviço externo tem `client.ts` (`fetch` thin wrapper) + `types.ts`
(shape bruto). Nenhum cliente faz lógica de negócio.

- `tmdb/client.ts` — Bearer auth, language pt-BR, revalidate 1h.
- `omdb/client.ts` — apikey query string, revalidate 30 dias.
- `watchmode/client.ts` — apiKey query, revalidate 7 dias.
- `movieofthenight/client.ts` — RapidAPI header, revalidate 14 dias.

### normalizers

Converte respostas externas em entidades canônicas POPLOG.

- `tmdb-title.ts` → `PoplogTitle` (campos base).
- `tmdb-title-details.ts` → `PoplogTitleDetails` (base + runtime, status,
  tagline, genres, cast, crew filtrada por job, videos, recommendations,
  similar, first_air_date, last_air_date, next/last_episode_to_air,
  seasons, production_companies, production_countries, spoken_languages,
  belongs_to_collection, networks, created_by, budget, revenue, etc).
- `omdb-ratings.ts` → `PoplogRatings` (parser de "N/A" e "123,456").

### cache

Cada cache valida frescor temporal **e** completude de payload quando
aplicável. Toda mutação é idempotente via `upsert(onConflict=...)`.

- `cache-config.ts` — TTLs por endpoint.
- `is-title-cache-fresh.ts` — `isTitleCacheFresh()` (TTL 7d) +
  `isTitlePayloadComplete()` (verifica chaves obrigatórias: `credits`,
  `videos`, `recommendations`, `external_ids`, `watch/providers`).
- `title-cache.ts` — `getCachedTitle`, `getCachedTitleWithPayload`,
  `upsertCachedTitle` (preserva imagens existentes contra payloads
  incompletos, faz re-leitura pra validar persistência real).
- `ratings-cache.ts` — TTL 30d, upsert por `(tmdb_id, media_type)`.
- `external-ids-cache.ts` — upsert preservando IDs já conhecidos.
- `availability-cache.ts` — `replaceAvailability` faz delete+insert pra
  evitar linhas órfãs quando providers somem do TMDB.
- `season-cache.ts` — TTL 7d, persiste season + episodes em duas tabelas.

### sync

Orquestram cache + clientes externos + estratégia de fallback.

- `sync-tmdb-title.ts` — append_to_response `credits,videos,images,
  recommendations,similar,external_ids,watch/providers`. Fallback en-US
  pra imagens, persiste external_ids automaticamente, retorna
  `rawPayload` em memória pra alimentar syncs subsequentes.
- `sync-omdb-ratings.ts` — se sem imdb_id, ainda persiste TMDB rating +
  POPLOG Score parcial. Falha graciosa.
- `sync-availability.ts` — **cascata estrita**: TMDB primário (lê do
  `rawPayload` em memória), Watchmode fallback (com deep_link
  `web_url`), MotN fallback (com link + quality). Quando TMDB devolve,
  limpa fontes de fallback no banco.
- `sync-tmdb-season.ts` — lazy, puxa uma temporada por vez sob demanda
  do Episode Browser.

### strategies

`api-priority.ts` (catálogo da hierarquia de fontes por tipo) e
`fallback-strategy.ts` (decisões puras: quando usar Watchmode, quando
enriquecer com OMDb, quando evitar chamadas caras).

### rate-limits

Constantes `API_BUDGETS` (daily/monthly) e `API_COOLDOWNS` (intervalo
mínimo entre chamadas). Sem enforcement ativo ainda — apenas
configuração pronta para um middleware futuro.

### library

- `types.ts` — `Poplog3LibraryStatus`, `Poplog3UserTitle`.
- `validators.ts` — `isValidMediaType`, `isValidLibraryStatus`,
  `parsePositiveInteger`.
- `library-service.ts` — `getUserLibrary`, `getUserTitleStatus`,
  `upsertUserTitleStatus`, `removeUserTitle`. Usa service_role.

### episodes

- `episode-progress-service.ts` — coração do sistema séries×usuário.
  Funções: `toggleEpisodeWatched`, `bulkMarkEpisodesWatched`,
  `markAllAiredEpisodes`, `clearSeriesProgress`,
  `getWatchedEpisodesForSeries`, `computeUserSeriesProgress`,
  `getUserWatchingSeries` (helper preparado pra Acompanhando).
  Auto-sync: marcar episódio promove a série pra `watching` em
  `poplog3_user_titles` se ainda não estiver `watched`.

### supabase

- `admin.ts` — service role (server-only).
- `server.ts` — SSR com cookies.
- `client.ts` — browser com anon key (respeita RLS).

### auth

- `get-current-user.ts` — `getCurrentUser()` via server client.

### types

Tipos canônicos POPLOG: `PoplogTitle`, `PoplogTitleDetails`,
`PoplogRatings`, `PoplogSeason`, `PoplogEpisode`, `ApiLogEntry`.

---

## 5. Camada lib (`src/lib/`)

Regras de domínio puras, sem dependência de Supabase ou React.

### lib/series

- `types.ts` — `SeriesState` (coming-soon / episode-available /
  in-season / awaiting-next-season / finished / unknown), `MovieState`
  (coming-soon / released / unknown), `TitleAvailabilityState`.
- `series-state.ts` — `computeSeriesState`, `computeMovieState`,
  `seriesStateFromTitle`, `availabilityStateFromTitle`.
- `format.ts` — labels PT-BR + mapeamento pra variant da `StatusBadge`.

### lib/score

- `poplog-score.ts` — `computePoplogScore` ponderado (IMDb 40, RT 30,
  Metacritic 20, TMDB 10) com redistribuição proporcional quando faltam
  fontes. Função pura, validada com 5 cenários.

---

## 6. APIs internas (`src/app/api/`)

### Canônicas v3 (`/api/poplog3/`)

| Rota | Método | Função |
| --- | --- | --- |
| `/api/poplog3/titles/[mediaType]/[id]` | GET | Endpoint mestre da Title Page. Aceita `?refresh=1` e `?country=BR`. Retorna `TitlePageData` completo: hero + ratings + providers + cast + crew + seasons + nextEpisode + userState + userSeriesProgress + cacheInfo. |
| `/api/poplog3/tv/[id]/seasons/[season]` | GET | Detalhe lazy de temporada (puxa via `syncTmdbSeason`). |
| `/api/poplog3/episodes` | POST | 4 modos: toggle, bulk, markAllAired, clear. Auto-sync de status com `poplog3_user_titles`. |
| `/api/poplog3/series/[id]/progress` | GET | Progresso atualizado do usuário pra uma série. |

### Library (legado v2-style, mas funcional)

| Rota | Método | Função |
| --- | --- | --- |
| `/api/library` | GET | Lista a biblioteca completa do usuário. |
| `/api/library/title` | GET/POST/DELETE | CRUD do estado pessoal por título. |

### Debug

`/api/debug/{health,config,supabase,tmdb,omdb,watchmode,movieofthenight}`.

### Existentes mas pouco explorados

`/api/discover`, `/api/search`, `/api/trending`,
`/api/title/[mediaType]/[id]` (versão antiga; o canônico é o
`/api/poplog3/titles/...`), `/api/admin/hydrate-library`.

---

## 7. UI

### Rotas atuais

| Rota | Status |
| --- | --- |
| `/` | Stub CleanPage |
| `/buscar` | Stub CleanPage |
| `/filmes` | Stub CleanPage |
| `/series` | Stub CleanPage |
| `/sorteio` | Stub CleanPage |
| `/settings` | Stub CleanPage |
| `/agenda` | Stub CleanPage |
| `/estudio/[kind]/[id]` | Stub CleanPage |
| `/franquia/[id]` | Stub CleanPage |
| `/generos/[media]/[id]` | Stub CleanPage |
| `/pessoa/[id]` | Stub CleanPage (cast/crew já linkam pra cá) |
| `/debug/apis` | Funcional |
| `/acompanhando` | **Placeholder coerente** — hero + grid dos watching + card honesto "em construção" |
| `/library` | **Padrão-ouro** — feature completa em `src/features/library/` |
| `/title/[mediaType]/[id]` | **Completa premium** — `src/features/title/*` |

### Design system (`src/components/ui/`)

Primitivos compartilhados:

`ActionButton`, `EmptyState`, `PageHeader`, `PosterCard`, `ProgressCard`,
`ProviderBadge`, `SectionHeader`, `StatusBadge`, `Toolbar`, `icons`.

Convenções: glass cards (`bg-white/[0.035]` + `backdrop-blur-xl` +
`border-white/[0.08]`), accents indigo/cyan/amber/rose/neutral, tracking
apertado em headers (`tracking-[-0.03em]`), eyebrow uppercase
(`tracking-[0.22em]`), gradients radiais sutis nos cards.

`CleanPage` (`src/components/layout/CleanPage.tsx`) é wrapper de
transição: `PageHeader` + `EmptyState`. Stubs herdam o look premium.

`Sidebar` usa Supabase Auth no client, links corretos pra
`/library?tab=watchlist` e `/acompanhando`.

### Title Page (`src/features/title/`)

Componentes plugados:

- `TitlePageView` — orquestrador (RSC).
- `TitleHero` — backdrop 88vh + overlays atmosféricos + poster com glow
  lateral + título clamped + tagline + meta row + chip POPLOG/TMDB +
  bloco "Continuar S##E## · X/Y · barra" quando user tem progresso +
  `TitleActions`.
- `TitleActions` (cliente) — Watchlist / Marcar assistido / Assistindo /
  Favorito / Gostei / Não curti. Auto-sync `markAllAired` ao marcar
  série como assistida.
- `TitleSeasonsCard` — estado da série + próximo episódio agendado +
  contagem temporadas/episódios.
- `TitleEpisodeBrowser` (cliente) — switcher de temporadas filtradas +
  fetch lazy + card por episódio com thumbnail, S##E##, rating, data,
  runtime, overview + checkbox watched com optimistic update e rollback.
- `TitleCast` (cliente) — scroll horizontal com setas + gradientes
  laterais; cada card linka pra `/pessoa/[id]`.
- `TitleCrew` — cards verticais agrupados por função
  (Direção, Roteiro, Trilha sonora, etc); cada nome linka pra
  `/pessoa/[id]`.
- `TitleRecommendations` — grid com `PosterCard`.
- `TitleMetadata` — ficha técnica discreta em cards verticais (Números,
  Origem, Emissoras, Produção) + card de franquia/coleção.
- `TitleProviders` — providers agrupados por tipo, logo TMDB, deep link
  como `<a target="_blank">`, badge de quality, indicador da fonte.
- `TitleScoreCard` — POPLOG Score com anel colorido por faixa + 4 cells
  individuais.
- `TitleTrailer` (cliente) — modal YouTube embed.
- `TitleSyncBar` (cliente) — debug flutuante: status do cache (título +
  ratings + availability) + "há quanto tempo foi a última sync" +
  botão "Forçar re-sync agora" que dispara `?refresh=1`.

---

## 8. Fluxo de leitura: abrir uma Title Page

1. `GET /title/tv/12345` → RSC lê `searchParams.refresh|force`.
2. RSC faz `fetch http://host/api/poplog3/titles/tv/12345?refresh=…`.
3. Endpoint chama `syncTmdbTitle(tv, 12345, { force })`:
   1. `getCachedTitleWithPayload`.
   2. Se cache fresh **E** payload completo → retorna direto.
   3. Senão chama TMDB com append, normaliza, upsert title +
      external_ids.
4. Endpoint chama `syncOmdbRatings(imdbId, tmdbRating)`:
   1. Lê cache (TTL 30d). Se fresh → retorna direto.
   2. Senão chama OMDb, normaliza, computa POPLOG Score, persiste.
5. Endpoint chama `syncAvailability(country=BR, tmdbPayload, imdbId)`:
   1. TMDB primário (lê `watch/providers` do `rawPayload`).
   2. Watchmode fallback.
   3. MotN fallback.
   4. Persiste em `poplog3_title_availability`.
6. Se usuário logado e série, chama `computeUserSeriesProgress` →
   junta `poplog3_user_episodes` + `poplog3_episodes` + total da série.
7. Computa `availabilityState` via `lib/series` (regra global).
8. Filtra `seasons[]` válidas (`season_number > 0` E (air_date passada
   OU air_date < 120 dias OU episode_count > 0)).
9. Valida `nextEpisode` contra `seasonNumbers` válidas.
10. Monta `TitlePageData` (shape canônico) e retorna.
11. RSC renderiza `TitlePageView`.

---

## 9. Fluxo de escrita: marcar episódio como assistido

1. UI cliente `TitleEpisodeBrowser` → `POST /api/poplog3/episodes`
   `{ seriesTmdbId, seasonNumber, episodeNumber, watched: true,
   runtimeMinutes }`.
2. Endpoint valida user (auth), chama `toggleEpisodeWatched`.
3. `toggleEpisodeWatched`:
   1. `upsert` em `poplog3_user_episodes`.
   2. Lê status atual de `poplog3_user_titles`.
   3. Se não é `watched`/`watching`, promove a série pra `watching`.
4. Retorna `UserSeriesProgress` atualizado.
5. UI faz optimistic update do `Set` de keys, depois reconcilia com a
   resposta do servidor.

---

## 10. Estado real (sólido vs. pendente)

### Sólido
- Arquitetura server completa (api-clients, normalizers, cache, sync,
  strategies, rate-limits, episodes, library, supabase, auth, types).
- POPLOG Score persistido + visualizado.
- Streaming (TMDB primário + Watchmode/MotN fallback) com deep links.
- Cache stale automático quando payload está incompleto.
- Series-state global em `lib/series` consumido em todos os pontos.
- Sistema séries×usuário com `poplog3_user_episodes`, service layer,
  routes e helper `getUserWatchingSeries` pronto para Acompanhando.
- Design system com 10 primitivos compartilhados.
- Title Page premium completa.
- `/library` completa.

### Em construção / pendente
- `/acompanhando` — só placeholder (Fase 5).
- `/` (Home como radar vivo) — stub (Fase 6).
- `/agenda` — stub (Fase 7, depende de tabela de eventos persistidos).
- `/buscar`, `/filmes`, `/series`, `/sorteio`, `/settings`,
  `/estudio/[kind]/[id]`, `/franquia/[id]`, `/generos/[media]/[id]`,
  `/pessoa/[id]` — stubs CleanPage.
- Rate limit enforcement ativo — só constantes hoje.
- Migrations versionadas em `supabase/migrations/` — todas estão no
  Supabase, mas a pasta local está vazia.
- Library com primitivos compartilhados — usa componentes locais
  hoje, pode migrar.
- Componentes mortos `TitleLibraryActions` e `CardActionButton`
  estão neutralizados como `export {}` `@deprecated`. Podem ser
  excluídos do repo a qualquer momento.
- Arquivos `_test-series-state.ts` e `_test-poplog-score.ts` na raiz
  são stubs `export {}` inertes (vestígios das validações de fase).
- `TitleSynopsis` existe como componente opcional mas não está plugado
  no `TitlePageView` (o hero já mostra overview); fica disponível para
  variantes de layout futuras.

---

## 11. Como explorar manualmente

### Botão de debug (Title Page)

Canto inferior direito de qualquer página `/title/...`. Mostra status
do cache de título, ratings e availability + botão "Forçar re-sync
agora". É o atalho rápido pra testar mudanças.

### URL params

- `?refresh=1` ou `?force=1` em qualquer `/title/...` ou diretamente
  no endpoint `/api/poplog3/titles/...` ignora todos os TTLs e re-puxa
  TMDB + OMDb + availability.
- `?country=US` (no endpoint) força lookup de availability em outro
  país.

### Endpoints úteis no terminal

```bash
# Title completo
curl 'http://localhost:3000/api/poplog3/titles/tv/66732?refresh=1'

# Progresso de série do user (precisa cookie de auth)
curl 'http://localhost:3000/api/poplog3/series/66732/progress' \
  -H 'cookie: …'

# Marcar episódio
curl -X POST 'http://localhost:3000/api/poplog3/episodes' \
  -H 'content-type: application/json' \
  -H 'cookie: …' \
  -d '{"seriesTmdbId":66732,"seasonNumber":1,"episodeNumber":1,"watched":true}'
```

### Consultas SQL úteis

```sql
-- Quantos títulos têm payload completo?
SELECT
  COUNT(*) FILTER (WHERE tmdb_payload ? 'watch/providers') AS com_providers,
  COUNT(*) FILTER (WHERE tmdb_payload ? 'external_ids')    AS com_ids,
  COUNT(*) AS total
FROM public.poplog3_titles;

-- Progresso agregado de um usuário
SELECT series_tmdb_id, COUNT(*) AS watched
FROM public.poplog3_user_episodes
WHERE user_id = '...'
GROUP BY series_tmdb_id
ORDER BY MAX(watched_at) DESC;

-- Availability por fonte
SELECT source, COUNT(*) FROM public.poplog3_title_availability
GROUP BY source;
```

---

## 12. Próximas frentes recomendadas (ordem sugerida)

1. **Fase 5 — `/acompanhando` completo**. Usa `getUserWatchingSeries`
   já pronto. Página agrupa por estado (em curso, próximo episódio
   chegando, finalizadas, abandonadas) e mostra "Continue assistindo".
2. **Fase 6 — Home como radar vivo**. Hero + chegou no streaming +
   trending + para você. Reutiliza `PosterCard`, `SectionHeader`,
   eventualmente novas queries (trending TMDB, recente em
   `poplog3_title_availability`).
3. **Fase 7 — Agenda persistida**. Schema novo
   `poplog3_agenda_events`, sync via MovieOfTheNight + TMDB calendário
   de séries, leitura por dia/semana.
4. **Polish da Library**: migrar `LibraryHero/Tabs/Grid/PosterCard`
   pra usarem os primitivos do design system, sem mudar look.
5. **Rate-limit enforcement** ativo (middleware bloqueia além do
   budget configurado).
6. **Versionar migrations locais** pra ter histórico Git do schema.

---

## 13. Convenções a manter

- **Nada na UI chama API externa.** Sempre passa pela camada interna.
- **Nada que serve UI lê service_role do cliente.** RLS no Supabase é a
  defesa principal; service role só server-side.
- **Regra global por tipo, não por tela.** Estado de série e POPLOG
  Score vivem em `lib/`. Telas só consomem.
- **Cache layer protege imagens antigas.** `upsertCachedTitle` nunca
  sobrescreve `poster_path`/`backdrop_path`/`title` válidos com null
  por engano.
- **Sync layer é onde mora o fallback estrito.** Não duplicar essa
  decisão na UI.
- **Tudo POPLOG3 tem prefixo.** Não criar tabelas sem `poplog3_*`.
- **Defensive coding em route handlers.** Cada bloco (ratings,
  availability, providers, próximo episódio) em try/catch próprio.
  Uma falha não derruba os outros.

