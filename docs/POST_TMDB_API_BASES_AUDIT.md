# POPLOG — Auditoria pós-TMDB das bases Trakt, TheTVDB e Balloonerismm

> Branch: `feature/new-api-system`
> Commits de referência: `bfe77c8` → `9ef47e8` → `5cf880a` → `71938ed` → `d00e818`
> Data: 2026-05-30
> Objetivo: Auditoria completa pós-migração TMDB, posicionamento das 3 bases principais e roadmap para a próxima fase.

---

## 1. Contexto

O POPLOG concluiu a etapa principal de saída do TMDB. O modo de operação atual é:

- **TMDB bloqueado** como fallback operacional via `TMDB_ACTIVE=false` e flags `TMDB_ALLOW_*=false`.
- **Source Engine** ativa como camada de abstração, com router, health, policy, logger e score implementados.
- **Trakt** como fonte principal pública de catálogo, com adapter parcialmente implementado.
- **TheTVDB e Balloonerismm** referenciados nos tipos e na política de fallback, mas **sem adapter, sem api-client e sem chave** no `.env.example`.
- **OAuth Trakt adiado** indefinidamente. O POPLOG opera com sua própria biblioteca de usuário.
- **`tmdb_id`** permanece como chave interna histórica. Não é mais usada para novas chamadas à API TMDB.

---

## 2. Estado atual da migração

### O que está operacional

| Componente | Status |
|---|---|
| `SourcePolicy` — flags TMDB bloqueadas | ✅ Implementado |
| `source-router.ts` — roteamento com fallback e health | ✅ Implementado |
| `source-health.ts` — circuit breaker por fonte | ✅ Implementado |
| `source-logger.ts` — logging de eventos de fonte | ✅ Implementado |
| `source-score.ts` — score de confiança | ✅ Implementado |
| `CatalogAdapter` — interface pública | ✅ Definida |
| `trakt-adapter.ts` — adapter Trakt | ✅ Implementado (parcial) |
| `src/server/api-clients/trakt/` — client, types, errors | ✅ Implementado |
| Normalizers: title, search, season, episode, person, image | ✅ Implementados |
| `user_title_state` — progresso e continuidade | ✅ 100% local, sem TMDB |
| Acompanhando / Continuidade | ✅ 100% local |
| Social (comentários, ratings Trakt) | ✅ Migrado |
| Agenda | ✅ Bloqueada via `TMDB_ACTIVE=false` |
| `syncCatalogSeason` substitui `syncTmdbSeason` | ✅ Em todos os fluxos operacionais |

### O que ainda é gap documentado

| Área | Gap | Controle |
|---|---|---|
| `/api/trending` | Ainda usa `tmdbFetch` | Gap documentado; retorna vazio com `TMDB_ACTIVE=false` |
| `/api/search` | Ainda usa `tmdbFetch` | Gap documentado; retorna vazio com `TMDB_ACTIVE=false` |
| `/api/poplog3/discover/special` | Ainda usa `tmdbFetch` | Gap documentado |
| `/api/poplog3/people/[id]` | Ainda usa `tmdbFetch` | Gap documentado |
| `image.tmdb.org` — provider logos | URLs históricas do banco | Dado histórico, não chamada nova |
| `TmdbImage.tsx` | Componente de imagem ainda usa base TMDB | Refactor pendente |
| `admin/hydrate-library` | Ainda usa `syncTmdbTitle` | Rota admin, não produção pública |
| Coleções/franquias | Sem substituto Trakt direto | Decisão arquitetural pendente |

---

## 3. O que foi feito

### Source Engine
- Tipos canônicos definidos: `SourceName`, `SourceArea`, `CatalogAdapter`, `CatalogTitle`, `CatalogSeason`, `CatalogEpisode`, `CatalogSearchResult`, `CatalogRatings`, `CatalogComment`, `CatalogPeople`, `CatalogVideo`, `CatalogCalendarItem`
- `SourcePolicy` centraliza todas as flags de bloqueio TMDB e ordem de fallback por área
- `routeSourceCall` e `routeWithPolicy` implementam roteamento com circuit breaker
- Normalizers completos para todos os tipos de catálogo

### Trakt
- `traktGet`, `traktGetSafe` implementados com retry, logging, headers obrigatórios
- `TraktApiError` com tipagem de erros
- `trakt-adapter.ts` implementa toda a interface `CatalogAdapter`: search, movie, show, seasons, episodes, trending, popular, related, ratings, comments, people, videos, calendar
- Mapeamento de IDs: `traktId`, `traktSlug`, `tvdbId`, `imdbId`, `tmdbId` (histórico)
- `extended=images` suportado nos tipos para posters/fanart via Trakt

### Biblioteca própria do POPLOG
- `user_title_state` continua como fonte canônica de progresso — não depende de nenhuma API externa
- OAuth Trakt corretamente adiado: sem `user_trakt_accounts`, sem `Authorization: Bearer`, sem rotas `/api/auth/trakt/*`

### Bloqueios TMDB
- `TMDB_ACTIVE=false` — padrão em produção
- `TMDB_ALLOW_PROVIDER_FALLBACK=false` — providers TMDB bloqueados
- `TMDB_ALLOW_IMAGE_FALLBACK=false` — `image.tmdb.org` bloqueado como fallback
- Guards adicionados em `social/highlights` e `social/movie-comments`

---

## 4. O que ficou de lado

### TheTVDB — nunca implementado
- Referenciada em `SourceName`, `SourcePolicy.getFallbackOrder()` e `source-health.ts`
- **Não existe** `src/server/api-clients/tvdb/`
- **Não existe** `src/server/source-engine/adapters/tvdb-adapter.ts`
- **Não existe** `TVDB_API_KEY` no `.env.example`
- A fonte aparece no fallback de `seasons`, `episodes`, `images`, `people`, `calendar` sem nenhuma implementação real

### Balloonerismm — nunca implementado
- Referenciada em `SourceName`, `SourcePolicy.getFallbackOrder()` e `source-health.ts`
- **Não existe** `src/server/api-clients/balloonerismm/`
- **Não existe** `src/server/source-engine/adapters/balloonerismm-adapter.ts`
- A fonte aparece no fallback de `search`, `trending`, `popular`, `ratings`, `people`, `videos`, `images`, `related`, `discovery` sem nenhuma implementação real

### Adapters Trakt — parcialmente pendentes
- O `trakt-adapter.ts` implementa a interface, mas o `source-engine/index.ts` só carrega `trakt` dinamicamente; `tvdb` e `balloonerismm` retornam `null` no `getAdapter()`
- As rotas `/api/trending`, `/api/search` e `/api/poplog3/discover/special` ainda chamam `tmdbFetch` diretamente, sem passar pela Source Engine

### Imagens
- Estratégia de CDN própria não definida
- `TmdbImage.tsx` não foi migrado para componente agnóstico
- `catalog_images.local_url` existe na política mas sem pipeline de ingestão de imagens Trakt/TVDB em produção

---

## 5. O que ainda falta

### Prioridade alta — bloqueia funcionalidades com TMDB_ACTIVE=false

1. **Adapter Trakt em `/api/trending`** — implementar `traktAdapter.getTrending()` na rota
2. **Adapter Trakt em `/api/search`** — implementar `traktAdapter.searchTitles()` na rota
3. **Adapter Trakt em `/api/poplog3/discover/special`** — trending e popular via Trakt

### Prioridade média — melhora cobertura e reduz risco

4. **api-client TheTVDB** — criar `src/server/api-clients/tvdb/` com autenticação JWT, tipos e fetch wrapper
5. **tvdb-adapter.ts** — implementar para seasons, episodes, series status, datas futuras
6. **TVDB_API_KEY no `.env.example`** — exige chave ou subscription
7. **Personas** — migrar `/api/poplog3/people/[id]` para Trakt people + enriquecimento TheTVDB
8. **`admin/hydrate-library`** — migrar de `syncTmdbTitle` para `syncCatalogTitle`

### Prioridade baixa — melhorias incrementais

9. **api-client Balloonerismm** — criar com rate limiting e TTL agressivo
10. **balloonerismm-adapter.ts** — somente para enriquecimento pontual (awards, trivia, quotes, soundtrack)
11. **`TmdbImage.tsx`** — migrar para componente agnóstico de fonte
12. **Provider logos** — pipeline de cache local para logos de provider
13. **Coleções/franquias** — tabela própria `poplog_collections` ou listas Trakt

---

## 6. Auditoria da base Trakt

### O que está implementado

O `trakt-adapter.ts` cobre toda a interface `CatalogAdapter`:

| Método | Endpoint Trakt | Status |
|---|---|---|
| `searchTitles` | `/search/movie,show,person` | ✅ Implementado |
| `getMovie` | `/movies/{id}?extended=full,images` | ✅ Implementado |
| `getShow` | `/shows/{id}?extended=full,images` | ✅ Implementado |
| `getSeasons` | `/shows/{id}/seasons?extended=full` | ✅ Implementado |
| `getEpisodes` | `/shows/{id}/seasons/{n}/episodes` | ✅ Implementado |
| `getTrending` | `/movies/trending`, `/shows/trending` | ✅ Implementado no adapter |
| `getPopular` | `/movies/popular`, `/shows/popular` | ✅ Implementado no adapter |
| `getRelated` | `/movies/{id}/related`, `/shows/{id}/related` | ✅ Implementado |
| `getRatings` | `/movies/{id}/ratings`, `/shows/{id}/ratings` | ✅ Implementado |
| `getComments` | `/movies/{id}/comments`, `/shows/{id}/comments` | ✅ Implementado |
| `getPeople` | `/movies/{id}/people`, `/shows/{id}/people` | ✅ Implementado |
| `getVideos` | `/movies/{id}/videos`, `/shows/{id}/videos` | ✅ Implementado |
| `getCalendar` | `/calendars/all/movies`, `/calendars/all/shows` | ✅ Implementado |

**Mas**: as rotas `/api/trending`, `/api/search` e `/api/poplog3/discover/special` **não estão usando o adapter**. Elas chamam `tmdbFetch` diretamente. O adapter existe mas não foi conectado às rotas.

### O que o Trakt cobre bem (sem OAuth)

- Search de filmes e séries por texto
- Trending e Popular (filmes e séries) — com cache TTL de 1h
- Detalhes completos de filme/série (`extended=full,images`)
- Temporadas e episódios (estrutura básica)
- Ratings públicos com distribuição por nota
- Comentários/shouts com flag de spoiler
- Créditos/pessoas (cast e crew)
- Vídeos/trailers quando disponíveis
- Títulos relacionados/similares
- Calendário público de estreias (filmes e episódios)
- IDs cruzados: `trakt_id`, `trakt_slug`, `tvdb_id`, `imdb_id`, `tmdb_id`

### O que o Trakt NÃO cobre

- Providers/disponibilidade de streaming por região — sem equivalente confiável
- Keywords/tags por título — sem endpoint direto
- Coleções/franquias — sem conceito nativo
- Artwork de qualidade alta (posters, backdrops) — `extended=images` retorna URLs remotas que precisam de cache obrigatório; Trakt **não permite hotlink direto** em produção
- Traduções/localização PT-BR — cobertura parcial
- Certificação etária por região não-US — retorna classificação US
- Ordens alternativas de temporadas (ex: ordem Netflix vs. ordem original) — TheTVDB é superior aqui
- Status detalhado de série (`nextAired`, `lastAired`, `nextEpisode` data) — TheTVDB é superior
- Biografia completa de pessoas — campos limitados vs. TMDB/Balloonerismm
- OAuth/watchlist/histórico pessoal — adiado indefinidamente

### Oportunidades imediatas (sem OAuth, sem risco)

- **Conectar o adapter às rotas**: `/api/trending` e `/api/search` já têm o adapter implementado — só falta wiring
- **Home/Trending/Discover**: `getTrending()` e `getPopular()` prontos para uso em seção TrendingNow e blocos editoriais
- **Busca**: `searchTitles()` pronto, cobre filme e série, deduplicação por `trakt_id`/`imdb_id`
- **Agenda**: `getCalendar()` pronto, cobre filmes e episódios futuros sem OAuth
- **Social**: comentários e ratings já migrados e em produção

---

## 7. Auditoria da base TheTVDB

### Estado atual no POPLOG

TheTVDB **não tem nenhuma implementação**. Aparece apenas como:
- `"tvdb"` em `SourceName`
- Fonte preferencial em `getFallbackOrder("seasons")` e `getFallbackOrder("episodes")`
- `tvdbId` como campo em `CatalogIds`

### O que o TheTVDB oferece (v4 API)

| Área | Capacidade |
|---|---|
| Séries | Metadados completos, status, datas, rede, idioma original |
| Temporadas | Múltiplos tipos de ordem (aired, DVD, alternativas nomeadas) |
| Episódios | Número, título, sinopse, data de estreia, runtime, imagem still |
| Ordens alternativas | Netflix re-cuts, ordem de DVD, ordem de produção — com nomes |
| `nextAired` | Data do próximo episódio a estrear |
| Updates incrementais | `/updates?since=<timestamp>` — essencial para sync eficiente |
| Tradução | Títulos, sinopses e nomes em múltiplos idiomas |
| Artwork | Posters, backdrops, banners, season art — com tipos tipados |
| Score de popularidade | Campo `score` por entidade para ranqueamento |
| IDs cruzados | `tvdb_id` → `imdb_id`, `slug` |
| Filmes | Cobertura menor que séries; foco histórico em TV |

### Onde TheTVDB deve ser fonte preferencial

- **Séries: estado e status** — `status.name` (Continuing, Ended, Upcoming), `nextAired`, `lastAired`
- **Temporadas: ordens alternativas** — único sistema que expõe `seasonTypes` nomeados
- **Episódios: dados canônicos** — número, data de estreia, stills, runtime oficial
- **Agenda: próximos episódios** — `nextAired` de séries que o usuário acompanha
- **Acompanhando** — atualização incremental via `/updates` para séries com `user_title_state`
- **Traduções** — títulos PT-BR de séries quando Trakt não tiver

### Modelo de acesso e risco

- Requer **cadastro e chave de API** em `thetvdb.com/dashboard`
- Modelo de licença: **subscription por usuário** ($12/ano) OU **contrato comercial**
- JWT token (expiração, necessita refresh)
- Rate limits não publicados; recomenda cache local ou proxy
- Boas práticas oficiais: manter cópia local do banco + updates incrementais
- **Risco de custo**: escalar sem contrato pode ter implicações financeiras
- **Risco de cobertura**: foco em TV; filmes têm cobertura menor que séries

### Adapter e infraestrutura necessários

```
src/server/api-clients/tvdb/
  client.ts     — JWT auth, refresh, traktFetch wrapper
  types.ts      — TvdbSeries, TvdbSeason, TvdbEpisode, TvdbArtwork, TvdbUpdate
src/server/source-engine/adapters/
  tvdb-adapter.ts — implementa CatalogAdapter parcialmente (seasons, episodes, calendar)
```

Variável de ambiente necessária: `TVDB_API_KEY`

TTLs recomendados:
- Séries: 1 dia (status pode mudar)
- Temporadas/Episódios: 6 horas
- Updates incrementais: rodar a cada 30 minutos em background job

---

## 8. Auditoria da base Balloonerismm

### O que é

API não oficial hospedada em Cloudflare Workers (`api.balloonerismm.workers.dev`). Usa **IMDb IDs** como chave primária. Interface TMDB-like mas com dados IMDb-first. Não requer autenticação visível na documentação pública.

### Endpoints disponíveis

**Filmes:**
`/movie/{id}`, `/movie/{id}/credits`, `/movie/{id}/images`, `/movie/{id}/videos`, `/movie/{id}/awards`, `/movie/{id}/trivia`, `/movie/{id}/quotes`, `/movie/{id}/soundtrack`, `/movie/{id}/recommendations`, `/movie/{id}/similar`, `/movie/{id}/reviews`, `/movie/{id}/translations`, `/movie/{id}/keywords`, `/movie/{id}/filming_locations`, `/movie/{id}/faqs`, `/movie/{id}/parental_guide`, `/movie/{id}/taglines`, `/movie/{id}/technical_specs`, `/movie/{id}/release_dates`, `/movie/top_rated`, `/movie/upcoming`

**TV:**
Mesma estrutura, mais: `/tv/{id}/season/{n}`, `/tv/{id}/season/{n}/episode/{ep}`, `/tv/airing_today`, `/tv/top_rated`

**Pessoas:**
`/person/{id}`, `/person/{id}/combined_credits`, `/person/{id}/movie_credits`, `/person/{id}/tv_credits`, `/person/{id}/images`, `/person/{id}/awards`, `/person/{id}/trivia`, `/person/{id}/external_ids`

**Busca:**
`/search/multi`, `/search/movie`, `/search/tv`, `/search/person`, `/search/company`, `/search/keyword`

**Discover:**
`/discover/movie`, `/discover/tv` — com filtros e paginação

**Popular:**
`/popular/all`, `/popular/movie`, `/popular/tv`

**Outros:**
`/trailers/trending`, `/trailers/popular`, `/trailers/recent`, `/calendar`, `/news/{category}`, `/interest/{id}`, `/interests`

### Capacidades únicas relevantes para o POPLOG

| Dado | Endpoint | Valor para POPLOG |
|---|---|---|
| Vídeos com playback direto (CloudFront) | `/{id}/videos` | URLs assinadas 1080p/720p/480p/HLS — expiram ~24h |
| Awards/prêmios | `/{id}/awards` | Completamente ausente no Trakt |
| Trivia | `/{id}/trivia` | Completamente ausente no Trakt |
| Quotes | `/{id}/quotes` | Completamente ausente no Trakt |
| Soundtrack | `/{id}/soundtrack` | Completamente ausente no Trakt |
| Fanart agregado | resposta de `/popular/*` | `FanartMovie` com logos, backdrops, posters, clearart |
| Parental guide | `/{id}/parental_guide` | Complementa classificação |
| IDs externos completos | `/{id}/external_ids` | IMDb, TMDB, Facebook, Twitter, YouTube |
| Person: bio e death info | `/person/{id}` | `death_cause`, `death_status`, `birth_name`, `height` |
| News | `/news/{category}` | MOVIE, TV, CELEBRITY, ALL_INDUSTRY |
| Watch providers | `/{id}/watch/providers` | Por região — potencial sinal terciário |
| Filming locations | `/{id}/filming_locations` | Enriquecimento contextual |

### Regras obrigatórias de uso

1. **Nunca usar como fonte única crítica** — API não oficial, sem SLA, sem suporte
2. **Nunca chamar no render de cards/listas grandes** — rate limit desconhecido, pode derrubar
3. **Sempre via adapter com cache e TTL** — mínimo 24h para dados estáticos, 1h para trailers (URLs expiram)
4. **Registrar `source = "balloonerismm"` e `confidence: "low"` em todo dado**
5. **Apenas fallback ou enriquecimento sob demanda** — nunca caminho primário
6. **TTL de trailers = 12h máximo** — URLs CloudFront expiram em ~24h; renovar antes de expirar
7. **IMDb ID obrigatório** — API usa IMDb IDs como chave; precisa de mapeamento `imdb_id` ↔ `poplog_id`

### Risco jurídico e operacional

- **Risco jurídico**: API não oficial que agrega dados IMDb + Fanart.tv. IMDb tem ToS restritivos sobre scraping e redistribuição. Uso em produção pode gerar notificação.
- **Risco operacional**: Sem SLA, sem versionamento garantido, pode sair do ar ou mudar sem aviso. Cloudflare Workers tem limites de rate.
- **Risco de dependência**: Usar em produção amplamente cria dependência de infraestrutura fora do controle do POPLOG.

### O que pode usar com segurança

- `awards`, `trivia`, `quotes`, `soundtrack` — enriquecimento na página de título, carregado lazy sob demanda, sem impacto no render principal
- `filming_locations`, `faqs`, `taglines` — seções expandíveis/opcionais
- `person/{id}` — bio, trivia, awards de pessoa quando Trakt tiver dados insuficientes
- `trailers` — backup para quando YouTube API falhar, com TTL de 12h máximo

### O que NÃO deve usar

- `search` como fonte principal — Trakt é mais confiável e oficial
- `discover` como fonte principal — Trakt é mais confiável
- `watch/providers` como fonte confiável — dados de onde assistir precisam de fonte verificada
- Trending/Popular como base editorial — Trakt é mais adequado
- Qualquer endpoint em listas/cards de produto — apenas páginas individuais sob demanda

---

## 9. Matriz por área do produto

| Área | Fonte principal | Fonte secundária | Fallback | Cache obrigatório | Observação |
|---|---|---|---|---|---|
| Busca | Trakt `/search` | TheTVDB | Balloonerismm/local | Sim (1h) | Deduplicar por `trakt_id`/`imdb_id`. **Adapter pronto, rota não conectada.** |
| Trending/Popular | Trakt `/trending`, `/popular` | Local cache | Balloonerismm experimental | Sim (1h) | Nunca em render direto sem cache. **Adapter pronto, rota não conectada.** |
| Filmes — detalhe | Trakt `extended=full,images` | Balloonerismm (lazy) | Local cache | Sim (7d) | Balloonerismm apenas para awards/trivia/quotes |
| Séries — detalhe | Trakt `extended=full,images` | TheTVDB | Local cache | Sim (1d) | TheTVDB forte em status e datas |
| Temporadas | TheTVDB | Trakt | — | Sim (6h) | TheTVDB superior em ordens alternativas |
| Episódios | TheTVDB | Trakt | — | Sim (6h) | TheTVDB superior em datas futuras e stills |
| Social (comentários) | Trakt comments | Local cache | — | Sim (30min) | Spoilers/lazy load já implementado |
| Social (ratings) | Trakt ratings | Local cache | Balloonerismm (vote_average) | Sim (1h) | Balloonerismm pode complementar com metascore |
| Imagens | `catalog_images.local_url` | TheTVDB artwork | Balloonerismm fanart/placeholder | Sim (90d) | Sem hotlink direto. `TmdbImage.tsx` precisa refactor. |
| Providers | Fonte futura (Watchmode) | Dado interno confirmado | Balloonerismm sinal fraco | Sim (1d) | Sem TMDB. Balloonerismm `/watch/providers` como sinal não-confiável. |
| Agenda | Trakt Calendar | TheTVDB `nextAired` | Local cache | Sim (1h) | Sem OAuth obrigatório |
| Pessoas | Trakt people | TheTVDB | Balloonerismm person | Sim (7d) | Balloonerismm tem bio/death info mais completo |
| Vídeos/trailers | Trakt videos | YouTube API | Balloonerismm (TTL 12h) | Sim (12h) | Balloonerismm tem playback CloudFront |
| Discover | Trakt trending/popular + filtros locais | Local cache | — | Sim (6h) | Sem TMDB Discover |
| Relacionados/similares | Trakt related | Balloonerismm similar | — | Sim (1d) | Balloonerismm pode complementar |
| Acompanhando | `user_title_state` (local) | — | — | N/A | 100% local, sem API externa |
| Biblioteca | `user_titles` (local) | — | — | N/A | 100% local, sem API externa |
| Awards/Trivia | Balloonerismm | — | — | Sim (7d) | Uso sob demanda, lazy, nunca no render principal |
| News | Balloonerismm `/news` | — | — | Sim (1h) | Experimental, não bloquear deploy |

---

## 10. Matriz de responsabilidades por fonte

| Fonte | Pontos fortes | Pontos fracos | Regime de uso |
|---|---|---|---|
| **Trakt** | Search, trending, popular, ratings, comentários, créditos, calendário, IDs cruzados | Imagens (hotlink proibido), providers, ordens alternativas de temporada, dados de status de série | Primário para catálogo público. Adapter implementado. Conectar rotas pendentes. |
| **TheTVDB** | Séries (status, `nextAired`), temporadas (ordens alternativas), episódios (datas, stills), updates incrementais | Filmes (cobertura menor), requer JWT, custo por usuário ou contrato | Complementar para séries. Preferencial em seasons/episodes. Não implementado — criar client + adapter. |
| **Balloonerismm** | Awards, trivia, quotes, soundtrack, biography completa de pessoas, playback de vídeos (CloudFront), fanart | API não oficial, sem SLA, IMDb ToS, rate limit desconhecido, URLs de video expiram | Fallback/enriquecimento sob demanda. Nunca fonte principal. Não implementado — criar com rate limiting agressivo. |
| **Local / `poplog3_titles`** | Sempre disponível, sem latência, dados históricos seguros | Pode estar desatualizado se sync falhar | Último fallback. Sempre presente. |

---

## 11. Oportunidades de melhoria

### Oportunidades imediatas (adapter Trakt já pronto)

1. **Conectar `/api/trending` ao adapter Trakt** — `getTrending()` já implementado no adapter, só falta wiring na rota. Alto impacto, baixo risco.
2. **Conectar `/api/search` ao adapter Trakt** — `searchTitles()` já implementado. Home e busca ficam funcionais sem TMDB.
3. **Conectar `/api/poplog3/discover/special`** — `getTrending()` e `getPopular()` resolvem os trending/popular. Apenas keywords não têm substituto direto (ocultar ou omitir).
4. **Agenda com `getCalendar()`** — `CalendarParams` e normalizer já existem. TheTVDB `nextAired` pode complementar quando implementado.
5. **Pessoas com `getPeople()`** — migrar `/api/poplog3/people/[id]` para Trakt como fonte principal.

### Oportunidades de médio prazo

6. **TheTVDB para séries/episódios** — criar client + adapter. Benefício direto em Acompanhando (datas mais confiáveis), Página de Série (status/nextAired), Temporadas (ordens alternativas).
7. **Pipeline de imagens** — usar `extended=images` do Trakt + `catalog_images` para servir URLs via proxy/storage local. Eliminar dependência de `image.tmdb.org`.
8. **Enriquecimento Balloonerismm lazy** — awards e trivia na página de título como acordeão/tab expandível. Cache de 7 dias. Nunca bloquear render principal.

### Oportunidades de longo prazo

9. **Watchmode como fonte de providers** — substituto definitivo para TMDB providers
10. **OAuth Trakt** — importação opcional de biblioteca pessoal, histórico, ratings
11. **Tabela `poplog_collections`** — substituir franquias TMDB com engine própria

---

## 12. Implementações recomendadas

### Agora — baixo risco, alto impacto, sem OAuth, sem API nova

| Implementação | Esforço | Impacto | Detalhe |
|---|---|---|---|
| Conectar `/api/trending` ao `traktAdapter.getTrending()` | Pequeno | Alto | Adapter pronto. Só wiring. |
| Conectar `/api/search` ao `traktAdapter.searchTitles()` | Pequeno | Alto | Adapter pronto. Só wiring. |
| Conectar `/api/poplog3/discover/special` ao Trakt trending/popular | Pequeno | Médio | Remover keywords ou ocultar bloco. |
| Migrar `/api/poplog3/people/[id]` para `traktAdapter.getPeople()` | Médio | Médio | Trakt tem menos metadados mas cobre o básico. |
| Migrar `admin/hydrate-library` de `syncTmdbTitle` para `syncCatalogTitle` | Médio | Baixo | Rota admin, não produção pública. |
| Adicionar `TVDB_API_KEY=` no `.env.example` como placeholder | Mínimo | Baixo | Documentar intenção antes de implementar. |

### Depois — dependem de implementação nova ou decisão arquitetural

| Implementação | Bloqueio | Detalhe |
|---|---|---|
| `src/server/api-clients/tvdb/` + `tvdb-adapter.ts` | Chave TVDB + contrato | Seasons/episodes mais confiáveis |
| `src/server/api-clients/balloonerismm/` + adapter | Avaliação jurídica | Somente para enriquecimento |
| `TmdbImage.tsx` → componente agnóstico | Estratégia de CDN definida | Pipeline de imagens completo |
| Pipeline `catalog_images` com Trakt `extended=images` | Infraestrutura storage | Necessário para eliminar `image.tmdb.org` |
| OAuth Trakt | Decisão de produto | Sync de biblioteca pessoal, histórico |
| Tabela `poplog_collections` | Decisão arquitetural | Substituir coleções TMDB |
| Watchmode como fonte primária de providers | Custo Watchmode | Substituir fallback TMDB de providers |

---

## 13. Implementações que devem ficar para depois

| Item | Motivo para adiar |
|---|---|
| OAuth Trakt | Não bloqueia nenhuma feature atual. Biblioteca própria do POPLOG é autônoma. |
| Conflitos POPLOG × Trakt | Depende de OAuth implementado |
| Substituição de `tmdb_id` como chave primária | Mudança estrutural no banco. `tmdb_id` é PK histórica de `poplog3_titles`, `user_title_state`, `poplog3_episodes`. Requer migração coordenada. |
| Remover `sync-tmdb-title.ts` | Aguarda migração de `admin/hydrate-library` |
| Remover `sync-tmdb-season.ts` | Arquivo orphan mas requer confirmação de edge functions |
| Remover `tmdb-trending-feed.ts` | Aguarda migração completa da Agenda |
| Fanart.tv como fonte de imagens | Avaliação de custo/licença |
| Balloonerismm em produção ampla | Avaliação jurídica pendente (ToS IMDb) |

---

## 14. Riscos e cuidados

### Risco técnico

| Risco | Nível | Mitigação |
|---|---|---|
| `/api/trending` e `/api/search` retornam vazio com `TMDB_ACTIVE=false` | Alto (funcionalidade) | Conectar adapter Trakt — é a próxima ação mais urgente |
| TheTVDB ausente no fallback de seasons/episodes | Médio | Source router tenta `tvdb` mas retorna null; Trakt cobre como segundo. Dados podem ser menos precisos. |
| `TmdbImage.tsx` em uso com `TMDB_ALLOW_IMAGE_FALLBACK=false` | Médio | Imagens históricas do banco ainda funcionam via URL armazenada. Novas consultas sem imagem caem em placeholder. |
| Balloonerismm no `getFallbackOrder()` sem implementação | Baixo | Retorna `null` silenciosamente no router. Não quebra. |
| `tmdb_id` como PK histórica — risco de acoplamento longo | Médio | Substituição é etapa futura coordenada. Por ora, apenas histórico. |

### Risco operacional

| Risco | Nível | Mitigação |
|---|---|---|
| TheTVDB exige subscription ($12/usuário) ou contrato | Alto (custo) | Negociar contrato comercial antes de expor em produção |
| Balloonerismm sem SLA, pode sair do ar | Alto (estabilidade) | Apenas fallback/enriquecimento. Nunca fonte crítica única. |
| Trakt rate limit sem OAuth | Médio | Cache agressivo por área. TTLs definidos em `SourcePolicy`. |
| URLs CloudFront da Balloonerismm expiram em ~24h | Médio | TTL de cache de trailers ≤ 12h. Refetch sob demanda. |

### Risco jurídico

| Risco | Nível | Mitigação |
|---|---|---|
| Balloonerismm agrega dados IMDb — ToS restritivo | Alto | Usar apenas enriquecimento opcional. Não em features core. Avaliar com assessoria jurídica antes de escalar. |
| TheTVDB — licenciamento por usuário | Médio | Contrato comercial ou subscription. Não escalar sem contrato. |
| Trakt — API pública com Client ID | Baixo | Uso conforme ToS. Sem OAuth de terceiros sem consentimento. |
| Hotlink de imagens de CDNs externas | Médio | Política `TMDB_ALLOW_IMAGE_FALLBACK=false` já implementada. Mesmo princípio para Trakt/TVDB imagens. |

---

## 15. Próximas etapas sugeridas

### Etapa imediata — sem nova API, sem código complexo

1. **Conectar adapter Trakt às rotas pendentes** (`/api/trending`, `/api/search`, `/api/poplog3/discover/special`) — bloqueia search e home de funcionar sem TMDB
2. **Migrar `/api/poplog3/people/[id]`** para `traktAdapter.getPeople()` — elimina último `tmdbFetch` em rota de produto
3. **Migrar `admin/hydrate-library`** de `syncTmdbTitle` para `syncCatalogTitle` — limpa último uso de sync TMDB em rota admin
4. **Adicionar `TVDB_API_KEY=` no `.env.example`** — sinaliza intenção antes de implementar

### Etapa seguinte — nova infra para TheTVDB

5. Criar `src/server/api-clients/tvdb/client.ts` com JWT auth
6. Criar `src/server/api-clients/tvdb/types.ts` com `TvdbSeries`, `TvdbSeason`, `TvdbEpisode`
7. Criar `src/server/source-engine/adapters/tvdb-adapter.ts` — implementar `getSeasons`, `getEpisodes`, `getCalendar`
8. Ativar TheTVDB no fallback de seasons/episodes (já está configurado em `getFallbackOrder`)
9. Implementar job de updates incrementais via `/updates?since=<timestamp>`

### Etapa futura — Balloonerismm e imagens

10. Avaliação jurídica do uso de Balloonerismm em produção
11. Criar `src/server/api-clients/balloonerismm/client.ts` com rate limiting explícito
12. Implementar enriquecimento lazy (awards, trivia) na página de título
13. Pipeline de imagens: `catalog_images` com Trakt `extended=images` + TheTVDB artwork
14. Migrar `TmdbImage.tsx` para componente agnóstico

### Etapa futura longa — OAuth e reestruturação

15. OAuth Trakt como feature opcional (não bloqueia nada atual)
16. Migração de `tmdb_id` como PK para `poplog_id`/`trakt_id`
17. Tabela `poplog_collections` ou listas Trakt para franquias
18. Watchmode como fonte primária de providers

---

## Referências

- `docs/TRAKT_GAPS_AND_TMDB_BLOCK_POLICY.md` — política de gaps e bloqueio TMDB
- `docs/TMDB_REMOVAL_CHECKLIST.md` — checklist de remoção TMDB
- `docs/TRAKT_MIGRATION_VALIDATION.md` — validação página a página
- `docs/API_SOURCE_POLICY.md` — regras de integração de APIs
- `docs/PRE_TRAKT_GAPS_REVIEW.md` — revisão de lacunas pré-etapa 14
- `src/server/source-engine/source-policy.ts` — flags e fallback orders
- `src/server/source-engine/adapters/trakt-adapter.ts` — adapter Trakt implementado
- `src/server/source-engine/adapters/catalog-adapter.ts` — interface CatalogAdapter
- Trakt API: `https://trakt.docs.apiary.io/`
- TheTVDB v4 API: `https://thetvdb.github.io/v4-api/`
- Balloonerismm API: `https://api.balloonerismm.workers.dev/docs`
