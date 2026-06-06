# RADAR - Guia tecnico do estado atual

Atualizado em 2026-06-06. Este documento descreve como o RADAR funciona hoje no codigo, nao como os relatorios antigos da raiz descreviam o sistema em maio.

## 1. Resumo executivo

O RADAR atual e composto por duas camadas:

1. `/api/ics/agenda`: pipeline principal de dados. Le o feed ICS do Banco de Series, agrupa episodios, tenta enriquecer os titulos com o banco local `poplog3Title`, aplica filtros estruturais/editoriais e monta as secoes do Radar.
2. `/api/radar`: endpoint de fachada para a pagina `/radar`. No modo geral, usa cache proprio em `continuity_section_cache` e chama `/api/ics/agenda` quando precisa reconstruir. No modo personalizado, chama o mesmo feed geral e filtra pelos `tmdbId`s da biblioteca do usuario.

Fontes externas TMDB para cinema, retrofill e trending estao, na pratica, desligadas ou stubadas. A fonte real de series continua sendo o Banco de Series via ICS; o enriquecimento de metadados vem do banco local, nao da API TMDB em tempo real.

## 2. Mapa dos arquivos principais

| Area | Arquivo | Responsabilidade atual |
|---|---|---|
| Pagina | `src/app/radar/page.tsx` | Server Component da rota `/radar`; nao pre-carrega dados, passa `initialData = null`. |
| Cliente | `src/app/radar/RadarClient.tsx` | Renderiza UI, abas, filtros visuais, hero/spotlight e alternancia Geral/Personalizado. |
| API Radar | `src/app/api/radar/route.ts` | Fachada `mode=general|personal`; cache em memoria + `continuity_section_cache`; filtro personalizado. |
| Pipeline ICS | `src/app/api/ics/agenda/route.ts` | Fetch do Banco de Series, agrupamento, enriquecimento local, filtros e secoes. |
| Parser ICS | `src/lib/ics-parser.ts` | Converte o calendario ICS em eventos. |
| Engine ICS | `src/lib/ics-engine.ts` | Agrupa eventos por titulo, janela de 30 dias e classificacao inicial. |
| Categorias | `src/lib/radar/categories.ts` | Taxonomia, regex por titulo, refinamento por genero/tipo TMDB e categorias bloqueadas. |
| Elegibilidade | `src/lib/radar/eligibility.ts` | Camada de bloqueios editoriais/hard blocks e penalidades teoricas. |
| Filtros UI | `src/lib/radar/content-type-filter.ts` | Classifica itens em `series`, `movies`, `anime` para o menu do cliente. |
| Cache ICS | `src/server/local-services/ics-agenda-cache-local.service.ts` e `src/server/repositories/ics-agenda-cache.repository.ts` | Cache persistente do payload de `/api/ics/agenda`. |
| Cache Radar | `src/server/continuity/continuity-section-cache.ts` e repository local | Cache persistente do payload de `/api/radar?mode=general`. |
| Admin cache | `src/app/api/admin/radar-cache-flush/route.ts` | Status/flush do cache ICS. |
| Admin personal debug | `src/app/api/admin/radar-personal-debug/route.ts` | Cruza biblioteca do usuario com feed ICS cacheado. |
| Admin TMDB toggle | `src/app/api/admin/tmdb-feed-toggle/route.ts` | UI/API existem, mas o modulo do feed TMDB esta hardcoded como desligado. |

## 3. Fluxo de dados atual

Fluxo do modo geral:

```text
Usuario entra em /radar
  -> page.tsx entrega RadarClient sem dados iniciais
  -> RadarClient faz GET /api/ics/agenda no primeiro load sem initialData
  -> /api/ics/agenda tenta cache em memoria e depois ics_agenda_cache
  -> se cache miss/stale/version mismatch:
       Banco de Series ICS
       -> parseIcsContent
       -> runIcsEngine(windowDays=30, includeHidden=false)
       -> localDbEnrichGroups(poplog3Title)
       -> reality classifier
       -> dedup por tmdb_id
       -> TMDB trending feed (sempre off hoje)
       -> filtros estruturais + classifyRadarEligibility
       -> clusters por data/temporada
       -> secoes today/thisWeek/next30Days
       -> escreve ics_agenda_cache
```

Fluxo do prefetch global:

```text
RootLayout monta RadarBackgroundPrefetch
  -> espera 6s + idle callback
  -> GET /api/radar?mode=general
  -> /api/radar tenta memory cache e continuity_section_cache
  -> se miss: chama /api/ics/agenda, embrulha payload e salva em continuity_section_cache
```

Isso significa que existem dois caminhos de aquecimento: o cliente da pagina chama `/api/ics/agenda` diretamente quando `initialData` e nulo, enquanto o prefetch global aquece `/api/radar?mode=general`.

## 4. Alimentacao de dados

### 4.1 Series e episodios

Fonte primaria: `http://bancodeseries.com.br/ical.php`.

O endpoint `/api/ics/agenda` busca o ICS com `cache: "no-store"` e `User-Agent: PoplogApp/1.0`. O parser gera eventos com serie, temporada, episodio, nome do episodio, inicio/fim e UID. A engine usa janela de 30 dias a partir de agora.

Regra de fonte atual:

- Series/episodios entram pelo Banco de Series.
- A API TMDB nao cria grupos de serie no pipeline normal.
- O enriquecimento real de serie e feito via `poplog3Title`, por match local de titulo normalizado.

### 4.2 Enriquecimento local

`localDbEnrichGroups()` le todos os registros `poplog3Title` com `mediaType = "tv"`, monta um mapa por `title` e `originalTitle` normalizados e preenche `group.tmdb` com campos compativeis com o contrato antigo:

- `tmdb_id`
- `name` e `original_name`
- `overview`
- `poster_path`, `backdrop_path`
- `genre_ids`, `genres`
- `popularity`, `vote_average`, `vote_count`
- `number_of_seasons`
- `origin_country`, `original_language`
- `first_air_date`
- `status`
- `networks`, `production_companies`

Limite importante: e matching exato normalizado por titulo. Nao ha busca fuzzy, aliases complexos ou chamada TMDB neste ponto. Se `poplog3Title` nao tiver o titulo ou o titulo estiver diferente, o grupo segue sem TMDB.

### 4.3 Cinema

A estrutura para cinema ainda existe (`CinemaReleaseGroup`, secoes `cinemaToday`, `cinemaThisWeek`, `cinemaNext`), mas hoje esta desativada:

- `fetchMovieReleaseDateBR()` retorna `null`.
- `fetchCinemaReleasesBR()` retorna `[]`.
- `cinemaReleases` e sempre `[]`.
- `movies` legado tambem e sempre `[]`.

Logo, o filtro "Filmes" da UI tende a ficar vazio, salvo se alguem religar a fonte de cinema.

### 4.4 TMDB Trending Feed

Existe API/admin para alternar o feed, mas `src/lib/radar/tmdb-trending-feed.ts` esta hardcoded:

- `TMDB_TRENDING_FEED_ENABLED_BY_ENV = false`
- `TMDB_TRENDING_FEED_ENABLED = false`
- `isTmdbFeedEnabled()` sempre retorna `false`
- `setTmdbFeedEnabled()` nao faz nada
- `fetchTmdbTrendingFeed()` retorna arrays vazios

Consequencia: `ENABLE_TMDB_TRENDING_FEED=true` no `.env` e o botao admin nao ativam nada no estado atual. A UI administrativa indica a intencao, mas o modulo real esta neutro.

### 4.5 Retrofill TMDB

`applyRetrofill` ainda e importado em `/api/ics/agenda`, e `RADAR_RETROFILL_MAX_SEASONS` ainda existe no `.env.example`, mas o pipeline atual nao chama `applyRetrofill()`. Portanto nao ha preenchimento automatico de episodio anterior via TMDB hoje.

## 5. Agrupamento e secoes

### 5.1 Agrupamento inicial

`runIcsEngine()`:

- filtra eventos entre agora e `now + 30 dias`;
- agrupa por titulo normalizado;
- calcula `episodeCount`, `nextAirDate`, `lastAirDate`, `spanDays`, lista de temporadas e episodios;
- classifica por `classifyTitle()`;
- se `includeHidden=false`, remove de cara categorias em `ALL_BLOCKED_CATEGORIES`.

Ha uma deteccao adicional de soap por volume: se a serie tem mais de 1 episodio por dia em uma janela de pelo menos 5 dias, vira `DAILY_SOAP`, exceto quando ja foi classificada como `SPORTS` ou `NEWS`.

### 5.2 Deduplicacao por TMDB ID

Depois do enriquecimento local, grupos ICS com o mesmo `tmdb_id` sao avaliados:

- se houver variantes regionais distintas (`variantCountry` diferente), o pipeline preserva todos;
- caso contrario, funde os episodios no grupo principal e remove os grupos duplicados.

### 5.3 Clusters de episodio

O backend nao renderiza um card por serie inteira. Ele cria clusters por:

```text
titulo/TMDB + data + temporada
```

Cada cluster recebe `sectionMeta` com:

- `section`: `destaques`, `novosEpisodios` ou `vemAi`;
- `badge`: label curto;
- `reason`: motivo/debug;
- `episodeDate`;
- `selectedEpisode`;
- `releasePattern`;
- `episodeLabel`;
- `clusterLabel`;
- primeiro e ultimo episodio.

Padroes detectados:

- `single_episode`
- `double_episode`
- `episode_range`
- `large_batch`
- `season_drop`
- `full_season`
- `daily_strip`

### 5.4 Janelas das secoes de series

O calendario usa data no fuso de Brasilia (`America/Sao_Paulo`) para definir o dia corrente.

| Secao backend | Nome conceitual | Janela atual |
|---|---|---|
| `sections.today` | Destaques | D-2 ate hoje; tambem D+1 antes de meio-dia BRT quando horario definido. |
| `sections.thisWeek` | Novos episodios | D+1 tarde/sem horario ate D+4. |
| `sections.next30Days` | Vem Ai | Marcos E01 de D+2 a D+30; episodios comuns de D+8 a D+30. |

Limite importante: D+5, D+6, D+7 sem milestone ficam fora das tres abas por regra atual.

Depois de montar os clusters, cada secao colapsa duplicatas por serie+temporada. Isso evita multiplos cards da mesma temporada dentro da mesma aba.

### 5.5 Seção "Visão Geral"

No cliente, `buildRawGroupsForViewMode("all")` junta `today`, `thisWeek` e `next30Days` e deduplica por `tmdb_id`. Se o item nao tem `tmdb_id`, ele entra sem essa deduplicacao numerica.

## 6. Cache

### 6.1 Cache do `/api/ics/agenda`

Camadas:

1. Memoria do processo: `memoryCache`, TTL 5 minutos.
2. Banco local: tabela `ics_agenda_cache`, ID `main`, payload JSON e `cached_at`.

Parametros:

- `CACHE_SCHEMA_VERSION = 10`
- `CACHE_TTL_H = 24`
- `CACHE_ID = "main"`

Leitura:

- se o cache em memoria esta valido, retorna imediatamente;
- senao le `ics_agenda_cache`;
- aceita somente `status = "hit"` e `payload.cacheVersion === 10`;
- se stale, ausente ou versao diferente, retorna `null` e o pipeline reconstrói.

Escrita:

- grava o payload completo em `ics_agenda_cache`;
- atualiza tambem o cache em memoria por 5 minutos.

Headers de resposta:

- cache hit ou miss retornam `Cache-Control: public, s-maxage=300, stale-while-revalidate=60`;
- modo `?debug=` usa `no-store`.

### 6.2 Cache do `/api/radar?mode=general`

Camadas:

1. Memoria do processo: `generalMemoryCache`, TTL 5 minutos.
2. Banco local: `continuity_section_cache`, com `sectionKey = "radar_general"`, `region = "BR"`, `language = "pt-BR"`.

Parametros:

- `RADAR_CACHE_TTL_MS = 10 minutos`
- `RADAR_MEMORY_CACHE_TTL_MS = 5 minutos`
- `Cache-Control: no-store` na resposta HTTP

Comportamento:

- `hit`: devolve payload salvo;
- `stale`: devolve payload stale imediatamente e dispara rebuild em background, com lock em `refreshes`;
- `miss`: chama `/api/ics/agenda`, monta `RadarResponse`, salva em `continuity_section_cache` e memoria.

Observacao: esse cache e separado do cache ICS. Um flush do cache ICS nao apaga necessariamente o cache `radar_general` em `continuity_section_cache`.

### 6.3 Cache do modo personalizado

`/api/radar?mode=personal` nao usa cache persistente proprio. Ele:

1. autentica o usuario;
2. chama `buildGeneralPayload()`, que por sua vez chama `/api/ics/agenda`;
3. le biblioteca local com `getLocalUserLibraryTmdbIds(userId)`;
4. filtra o payload geral pelos IDs de TV da biblioteca.

Header:

- usuario autenticado: `Cache-Control: no-store`;
- anonimo: `public, max-age=60`.

### 6.4 Prefetch em background

`RadarBackgroundPrefetch` roda em todas as paginas pelo `RootLayout`:

- espera 6 segundos;
- tenta `requestIdleCallback`;
- chama `/api/radar?mode=general`;
- usa `sessionStorage` para rodar uma vez por sessao do navegador.

Ele aquece o cache de `/api/radar`, nao necessariamente resolve o fato de `RadarClient` buscar `/api/ics/agenda` diretamente quando entra na pagina sem `initialData`.

## 7. Filtros, censura e bloqueios

Neste documento, "censura" significa qualquer regra que impede um titulo de aparecer ou reduz sua visibilidade. Hoje ha tres niveis.

### 7.1 Bloqueio estrutural por categoria

Definido em `categories.ts`:

```text
HIDDEN_CATEGORIES = SPORTS, NEWS, PODCAST, LIVE_EVENT, VARIETY
HARD_BLOCKED_CATEGORIES = DAILY_SOAP
ALL_BLOCKED_CATEGORIES = HIDDEN + HARD_BLOCKED
```

Essas categorias sao removidas:

- primeiro em `runIcsEngine(includeHidden=false)`;
- depois de novo no pipeline, considerando `group.tmdb.refined_category`.

`refineCategoryFromTmdb()` pode transformar um item em bloqueado se os generos/tipo indicarem `Soap`, `Talk Show`, `News`, `Reality`, `Documentary`, etc. Exemplo: `tmdbType = "Talk Show"` vira `VARIETY` e e bloqueado.

### 7.2 Elegibilidade editorial

Depois do filtro estrutural, o pipeline chama `classifyRadarEligibility()`.

Hard blocks atuais incluem:

- categoria hard blocked;
- `Soap` por tipo/genero/padrao no titulo;
- `Talk Show` ou `News` por tipo/genero;
- infantil pre-escolar explicito;
- infantil de nicho sem distribuicao relevante;
- devocional/religioso de nicho explicito;
- reality sem streaming global e sem provider BR;
- documentario de nicho sem streaming global/provider BR e baixa popularidade;
- dorama/drama asiatico serializado sem distribuicao global/provider BR;
- serie ibero-latina de nicho sem distribuicao global/provider BR;
- serie local americana/anglofona de nicho;
- conteudo fantasma sem rede, sem genero, sem provider BR e popularidade irrisoria.

Limite importante: o pipeline atual passa `keywords: null` e `brazilProviders: null` para a elegibilidade. Portanto regras que dependeriam de keywords TMDB ou providers BR ficam limitadas; varios conteudos podem ser bloqueados por "sem provider BR" mesmo que exista disponibilidade em outra tabela.

### 7.3 Penalidades soft

`classifyRadarEligibility()` tambem pode retornar penalidades, mas no pipeline atual elas nao sao aplicadas a score de exibicao. Se o item e elegivel, entra em `visibleGroups`. Nao ha `computeUnifiedScore + applyScorePenalties` nesse fluxo.

Na pratica, as penalidades servem hoje mais para diagnostico/log do que para ordenacao real.

### 7.4 Filtros visuais no cliente

Na pagina, o menu de filtros tem:

- `Todos`
- `Séries`
- `Filmes`
- `Animação`

`content-type-filter.ts` classifica:

- filmes: `isMovie` ou categoria `MOVIE`;
- anime: animacao asiatica ou padrao de titulo;
- animacao: animacao nao asiatica;
- reality/documentario/dorama/soap/unknown como tipos editoriais de TV.

Regra visual:

- `Animação` mostra anime + animacao;
- `Filmes` mostra `mediaType = movie`;
- `Séries` mostra qualquer TV que nao seja anime/animacao;
- `Todos` mostra tudo.

### 7.5 Compactacao por idioma no cliente

Existe `applyLanguageCap()` para compactar excesso de anime e idiomas nao livres:

- ingles, portugues e vazio: sem limite;
- anime: limite aproximado de 20% do grid, minimo 5;
- outros idiomas: maximo 2 por idioma antes de virar `compact`.

Porem, no retorno atual de `buildEditorialGroups()`, essa funcao nao e chamada. O codigo existe, mas nao participa do fluxo principal atual.

## 8. Ordenacao e scoring

### 8.1 Backend

O backend atual nao calcula `computeUnifiedScore()` no pipeline principal. Comentarios em `ics-engine.ts` dizem que `computeRelevanceScore`, threshold e `filterEnrichedGroup` foram removidos. Cada grupo visivel recebe `isRelevant = true`.

`score.ts`, `section-scorer.ts` e thresholds em `categories.ts` ainda existem, mas sao infraestrutura nao plugada no fluxo atual de `/api/ics/agenda`.

### 8.2 Cliente

O cliente ainda calcula score para ordenar visualmente:

- `groupEditorialScore()` considera `group.relevanceScore`, popularidade, trending sets, tier editorial, voto medio, estreia/finale/temporada, quantidade de episodios e penalidade de imagem.
- Como `trendingDay` e `trendingWeek` estao vazios hoje, os boosts de trending nao entram.
- Como `group.relevanceScore` fica normalmente `0`, a ordenacao efetiva depende bastante de popularidade TMDB e tier editorial no cliente.

`buildEditorialGroups()` ordena por:

1. `editorialTier()`
2. popularidade TMDB

e intercala filmes a cada 5 posicoes, embora cinema esteja vazio hoje.

## 9. Modo Personalizado

Endpoint: `/api/radar?mode=personal`.

Fonte da biblioteca:

```text
db.userTitleState
where userId = usuario
status in ["watching", "watchlist", "watched"]
```

`fridge` e excluido em `getLocalUserLibraryTmdbIds()`, apesar do endpoint admin de debug incluir `fridge` para diagnostico.

Filtragem:

- o backend filtra `groups`, `featuredGroups` e as secoes de series por `tvIds`;
- `movieIds` sao retornados separadamente como `libraryMovieIds`;
- a UI, ao alternar para personalizado, busca `/api/radar?mode=personal`, extrai IDs do payload filtrado e filtra o estado ja carregado no cliente;
- se nenhum ID de serie voltar, mostra estado vazio.

Limitacoes:

- filmes da biblioteca so aparecem se houver cinema no payload, mas cinema esta vazio;
- personal depende do feed geral conter a serie naquele momento;
- se a serie da biblioteca nao tem episodio no ICS, foi bloqueada, ou nao teve match de TMDB, nao aparece;
- o modo personalizado chama `/api/ics/agenda` de novo via `buildGeneralPayload()`, em vez de aproveitar diretamente o cache `radar_general`.

## 10. Admin e diagnostico

### 10.1 Cache Radar/Agenda

Tela: `/debug/radar` e aba admin `TabRadarCache`.

API: `/api/admin/radar-cache-flush`, protegida por `x-admin-secret = ADMIN_SECRET`.

GET retorna:

- se existe cache `ics_agenda_cache`;
- `cachedAt`;
- idade em horas;
- `payload.cacheVersion`.

POST:

- seta `cachedAt` de `ics_agenda_cache` para epoch;
- opcionalmente dispara GET `/api/ics/agenda` em background.

Limite: nao invalida `continuity_section_cache` do `/api/radar?mode=general`.

### 10.2 Personal debug

API: `/api/admin/radar-personal-debug`, com admin guard e usuario autenticado.

Retorna:

- `libraryTvCount`;
- `feedGroupsTotal`;
- `feedGroupsWithTmdb`;
- `matchCount`;
- IDs da biblioteca que batem com o feed;
- IDs ausentes;
- amostra de IDs do feed.

Usa `ics_agenda_cache` diretamente, nao reconstrói o pipeline.

### 10.3 Debug por titulo

API: `/api/ics/agenda?debug=<titulo-ou-key>`.

Ignora cache, executa pipeline completo e tenta localizar o titulo em `featuredGroups + secondaryGroups`. Retorna classificacao local, dados TMDB presentes, categoria refinada e filtros/hard blocks.

Limitacao importante: se o titulo foi bloqueado antes de entrar em `featuredGroups`, pode nao aparecer no relatorio final.

## 11. Variaveis de ambiente relevantes

| Variavel | Estado/uso atual |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Usado por `/api/radar` para chamar `/api/ics/agenda`; default local `http://localhost:3000`. |
| `ADMIN_SECRET` | Protege endpoints admin do Radar. |
| `DEBUG_RADAR` | Liga logs mais verbosos em filtros/debug. |
| `ENABLE_TMDB_TRENDING_FEED` | Existe no `.env.example`, mas o modulo atual ignora e retorna sempre desligado. |
| `TMDB_ACCESS_TOKEN` | Ainda citado por rotas/admin antigas, mas o pipeline atual de Radar nao depende dele para series. |
| `RADAR_RETROFILL_MAX_SEASONS` | Existe, mas retrofill nao e chamado hoje. |
| `POPLOG_LOCAL_RADAR_ENABLED` | Documentado como operacional para modo local; na pratica o Radar personal atual ja chama diretamente o servico local. |
| `POPLOG_LOCAL_CACHE_ENABLED` / `POPLOG_LOCAL_DB_ENABLED` | Historicamente controlavam adapters locais; os caches lidos aqui usam servicos locais diretamente. |

## 12. Contratos de resposta

### 12.1 `IcsAgendaResponse`

Campos importantes:

- `groups`
- `featuredGroups`
- `secondaryGroups`
- `movies`
- `cinemaReleases`
- `sections`
- `stats`
- `fetchedAt`
- `source`
- `pendingEnrichment`
- `trendingDay`
- `trendingWeek`
- `fromCache`
- `cachedAt`
- `cacheVersion`

`cacheVersion` atual: `10`.

### 12.2 `RadarResponse`

Campos importantes:

- `mode`
- `general`
- `generatedAt`
- `cacheVersion`
- `fromCache`
- `rawBdsMode` sempre `false`
- `sections`
- `libraryFiltered`
- `librarySize`
- `libraryMovieIds`
- `_debug`

## 13. Limitacoes e riscos atuais

1. A pagina `/radar` nao usa SSR/cache inicial. `page.tsx` sempre passa `initialData = null`, entao o cliente busca dados depois de montar.
2. Existem dois caches sobrepostos: `ics_agenda_cache` e `continuity_section_cache`. Invalidar um nao invalida o outro.
3. O prefetch global aquece `/api/radar`, mas o primeiro load da pagina ainda pode chamar `/api/ics/agenda` diretamente.
4. Cinema esta completamente desativado, apesar da UI e do contrato suportarem filmes.
5. TMDB Trending Feed tem UI/admin/env, mas o modulo real esta hardcoded como off.
6. Retrofill TMDB existe em arquivo/import, mas nao roda no pipeline atual.
7. `enrichSeriesGroups` tambem e importado, mas o pipeline usa enriquecimento local por `poplog3Title`.
8. Elegibilidade recebe `brazilProviders: null` e `keywords: null`; regras dependentes desses dados operam sem contexto completo.
9. Penalidades soft de elegibilidade nao alteram score no pipeline atual.
10. `score.ts`, `section-scorer.ts` e thresholds existem, mas nao estao plugados no backend atual.
11. O matching local por titulo e fragil para aliases, sufixos e divergencias entre BDS e cache local.
12. D+5, D+6 e D+7 sem milestone sao descartados intencionalmente das abas atuais.
13. O modo personalizado exclui `fridge` no filtro real, mas o debug admin inclui `fridge`, o que pode gerar diferenca de contagem.
14. O admin "TMDB Feed toggle" pode dar a impressao de funcionar, mas `setTmdbFeedEnabled()` e no-op.
15. Comentarios antigos ainda falam em Supabase/cache Supabase em alguns lugares, mas o codigo atual usa Prisma/MySQL local.

## 14. Pontos de alteracao recomendados para proximas mudancas

Se a proxima etapa for mexer no RADAR, vale decidir primeiro:

1. Qual endpoint deve ser a fonte unica da pagina: `/api/radar` ou `/api/ics/agenda`.
2. Se o cache principal sera `ics_agenda_cache`, `continuity_section_cache`, ou uma unica camada consolidada.
3. Se cinema deve ser religado, removido da UI, ou tratado como fase separada.
4. Se TMDB Trending Feed deve voltar, remover a UI/admin, ou implementar de verdade o flag.
5. Se elegibilidade deve usar availability/providers reais antes de bloquear por baixa relevancia no Brasil.
6. Se score backend deve voltar a ser a fonte de ordenacao, reduzindo a logica duplicada no cliente.
7. Se o modo personalizado deve filtrar no servidor e usar o payload retornado diretamente, em vez de refiltrar o estado local do cliente.
8. Se aliases/matching de BDS para `poplog3Title` precisam de tabela propria ou busca fuzzy.

## 15. Checklist rapido de verificacao

Para validar uma alteracao no Radar:

1. Verificar `/api/ics/agenda` com cache frio e cache quente.
2. Verificar `/api/radar?mode=general` com `continuity_section_cache` hit, stale e miss.
3. Verificar `/api/radar?mode=personal` com usuario autenticado e biblioteca vazia/cheia.
4. Conferir `/debug/radar` ou aba admin para idade e versao do cache.
5. Usar `/api/ics/agenda?debug=<titulo>` para casos suspeitos de bloqueio.
6. Conferir logs `[radar-source]`, `[Radar Eligibility]`, `[radar-sections]`, `[radar-sections-final]` e `[radar/personal/filter]`.
7. Rodar `npm run db:smoke:radar-agenda` quando mexer nos servicos locais de agenda/radar.
8. Fazer build/typecheck quando mexer em contrato TS entre API e cliente.

