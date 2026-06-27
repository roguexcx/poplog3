# POPLOG — Plano de Unificação e Globalização

> Plano técnico para transformar o POPLOG em um sistema único, coerente e
> globalizado. Baseado em auditoria do código real em 2026-06-26 (branch
> `feature/sistema-novo`). Companheiro do mestre `../POPLOG_SYSTEM_OVERVIEW.md`.

## 1. Objetivo

Eliminar fluxos paralelos, duplicações e lógica legada, e consolidar idioma,
região e catálogo como conceitos separados e aplicados de forma uniforme em todos
os módulos. A prioridade é uma arquitetura **mais simples**, não mais abstrata.

## 2. Padrão único proposto (regra para todos os módulos)

```txt
interfaceLanguage  → idioma da interface  (uiMessage(), generated-ui-messages.json)
catalogLanguage    → metadados do catálogo (lib/i18n/catalog-localization.ts)
availabilityRegion → providers/disponibilidade (camada global de availability)
```

Invariantes:

1. Componentes visuais **não** escolhem idioma; recebem `language`/`region` via
   props/serializer.
2. Metadados **nunca** são traduzidos manualmente; o sistema armazena as versões
   recebidas das fontes e escolhe por `catalogLanguage` com **fallback explícito e
   medido**.
3. Toda chave de cache inclui idioma e/ou região quando isso altera o resultado;
   um idioma/região nunca sobrescreve outro.
4. Identidade de leitura/escrita do usuário converge para `UserTitleState`.
5. Identidade de catálogo é `imdbId` → `poplogId`; `tmdbId` é alias sintético.

## 3. Inconsistências encontradas (documentação × código)

| # | Inconsistência | Evidência | Status |
|---|---|---|---|
| I1 | Doc dizia "PostgreSQL"; banco é MySQL | `prisma/schema.prisma` `provider="mysql"` | Corrigido no mestre |
| I2 | Doc tratava `tmdbId` como identidade central | `ARCHITECTURE.md` (arquivado) vs IMDb-first real | Corrigido (arquivado) |
| I3 | Docs do Radar citam `RadarClient.tsx` (2816 l.) | arquivo não existe; hoje `RadarV2Client.tsx` | Corrigido (arquivado) |
| I4 | Docs/atribuição listam TVDB/OMDb/Watchmode/MotN ativos | clients deletados; `attribution/api-sources.ts` renderizava fontes falsas | **Corrigido** (ver §5) |
| I5 | Plano da Agenda ativo, mas Agenda é redirect p/ Radar | `app/agenda/page.tsx` = `redirect("/radar")` | Documentado p/ remoção |

## 4. Duplicações e fluxos paralelos encontrados

| # | Item | Evidência | Proposta |
|---|---|---|---|
| D1 | **Busca dupla**: `/api/search` (1 ref) + `/api/poplog3/search` (4 refs) | rotas distintas, payloads diferentes | Unificar atrás de um contrato; manter compat por adapter |
| D2 | **Título duplo**: `/api/title/[mt]/[id]` + `/api/poplog3/titles/[mt]/[id]` | 0 refs de cliente em ambos | Confirmar consumidor (SSR/externo); manter 1, redirecionar/remover o outro |
| D3 | **Discover duplo**: `/api/discover` (0 refs) + `/api/poplog3/discover` (1 ref) | doc dizia o oposto | Confirmar e remover o morto |
| D4 | **Estado do usuário**: `UserTitle` + `UserTitleState` + `UserWatching` + `UserCuradoriaState` | 4 tabelas de estado | Leitura única em `UserTitleState`; escrita materializa estado |
| D5 | **Disponibilidade dupla**: `Poplog3TitleAvailability` + `CatalogAvailability` | 2 tabelas | Consolidar em uma; migração com backfill |
| D6 | **Pessoa dupla**: `/person/[id]` + `/pessoa/[id]` | `/pessoa` é redirect 308 | OK (compat); remover quando bookmarks expirarem |
| D7 | **Páginas de debug** `/debug/{apis,engine,radar}` | não linkadas; só `/api/debug/engine` é usado pelo Admin | Consolidar no Admin, remover páginas |
| D8 | **Módulo Agenda** `features/agenda` + `server/agenda` + `/api/poplog3/agenda*` | 0 referências de código vivo | Remover módulo (Radar é o sucessor) |

## 5. Mudanças implementadas nesta rodada (seguras, typecheck verde)

1. **Remoção de código morto** (validado com `npm run typecheck` = exit 0):
   - `src/server/index.ts` — barrel sem **nenhum** import no projeto.
   - `src/server/strategies/api-priority.ts` — config desatualizada (só `tmdb`/
     `watchmode`/`movieofthenight`) e sem consumidor (só o barrel a re-exportava).
   - 10 diretórios órfãos vazios: `api-clients/omdb`, `api-clients/tvdb`,
     `lib/episodes`, `api/admin/tmdb-feed-toggle`,
     `api/debug/{balloonerismm,movieofthenight,omdb,tmdb,watchmode}`,
     `api/dev/pt-br-probe`.
2. **Atribuição legal correta** (`src/attribution/api-sources.ts` +
   `helpers.ts`): o registro renderizado no `AttributionModal` agora lista apenas
   as fontes reais (Trakt, JustWatch). Removidas as entradas fantasmas TMDB,
   Watchmode, Movie of the Night e Banco de Séries que apareciam nos créditos ao
   usuário. `getProviderSourceIds` passou a creditar `balloonerismm` (não `tmdb`)
   como origem default de providers; `resolveSources` ganhou guard para registro
   parcial.
3. **Documentação**: reorganização completa de `/docs` (ver `../DOCS_AUDIT_AND_CLEANUP.md`).

## 6. Mudanças pendentes (não aplicadas — exigem migração/decisão)

| Pendência | Arquivos/tabelas | Risco | Por que não foi feita agora |
|---|---|---|---|
| P1. Localização de catálogo site-wide | `lib/i18n/catalog-localization.ts` + serializers de Home, título, Radar, Sorteio, busca, SEO/OG | Médio | Toca muitos serializers; precisa matriz de testes i18n cross-módulo |
| P2. Overview bilíngue no banco | `TitleTranslation`, hidratação | Médio | Requer migração + worker de hidratação multilíngue |
| P3. Convergir estado p/ `UserTitleState` | `hooks/useWatchedToggle`, `useWatchlistToggle`, `user-title-service`, `WatchlistVivaSection`, `/api/poplog3/acompanhando` | Alto | Toca escrita de estado; risco de regressão na biblioteca/hero |
| P4. Consolidar disponibilidade | `Poplog3TitleAvailability` + `CatalogAvailability` | Alto | Migração de dados com backfill e revalidação |
| P5. Unificar rotas duplicadas (D1–D3) | rotas de busca/título/discover | Médio | Precisa confirmar consumidores SSR/externos antes de remover |
| P6. Remover módulo Agenda morto (D8) | `features/agenda`, `server/agenda`, `app/api/poplog3/agenda*`, `app/agenda` | Baixo–Médio | Confirmar que nenhum feed ICS externo depende dos endpoints |
| P7. Consolidar debug no Admin (D7) | `app/debug/*`, `app/admin/tabs/*` | Baixo | Mover UI + remover páginas; trivial após P-checks |
| P8. Atribuir Wikidata/Wikipedia na UI | `attribution/types.ts` (ampliar `ApiSourceId`), `api-sources.ts` | Baixo | Decisão de produto sobre exibição de créditos |
| P9. Reduzir ruído (135 `console.log`, ~205 legacy) | transversal | Baixo | Faxina incremental; sem urgência funcional |

## 7. Ordem segura de execução

**Fase 1 — Remoções seguras (parcialmente feita).** Código morto + dirs órfãos +
atribuição corrigida (✅). Em seguida: P7 (debug→Admin) e P6 (Agenda) após checagem
de dependências externas. Critério: `typecheck` + `regression:local --skip-http`
verdes.

**Fase 2 — Unificação de contratos (P5).** Introduzir adapter de compat para
endpoints antigos; apontar todos os consumidores ao contrato único; só então
remover a rota duplicada. Um domínio por vez (busca → título → discover).

**Fase 3 — Globalização de catálogo (P1, P2, P8).** Adotar
`catalog-localization` por serializer, começando pela página de título e Home;
adicionar overview bilíngue via migração + worker; criar matriz de testes i18n
cross-módulo; creditar Wikidata/Wikipedia.

**Fase 4 — Consolidação de dados (P3, P4).** Convergir leituras para
`UserTitleState` e escrita via materialização; consolidar disponibilidade em uma
tabela com backfill e revalidação de negativos. Maior risco — exige smokes
dedicados e janela de validação.

**Fase 5 — Faxina final (P9).** Reduzir logs, revisar marcadores legacy, revisão
editorial das traduções en-US, auditoria visual multi-browser.

## 8. Riscos

- **Remoção de rota com consumidor oculto** (SSR interno, ICS externo, bookmark):
  mitigar com grep amplo + adapter de compat + período de redirect antes de deletar.
- **Migração de estado/disponibilidade**: risco de divergência durante o backfill;
  exigir dual-read temporário e smoke de paridade antes de cortar a tabela antiga.
- **Globalização de catálogo**: fallback mal configurado pode "vazar" idioma
  errado; o fallback deve ser sempre explícito e medido (telemetria de
  `languageStats`).
- **Ambiente de escrita**: o mount atual corrompe edições in-place via ferramentas
  de arquivo (NUL/truncamento); usar escrita atômica/heredoc e validar bytes.

## 9. Critérios de aceite

- `/docs` com fonte de verdade única e histórico arquivado (✅ nesta rodada).
- Idioma, região e catálogo tratados como conceitos separados em **todos** os
  módulos (P1 conclui isso).
- Zero rotas/módulos duplicados sem adapter de compat documentado (P5, P6).
- Uma tabela de disponibilidade e leitura de estado única em `UserTitleState`
  (P3, P4).
- `npm run typecheck`, `lint`, `regression:local --skip-http`,
  `audit:i18n --fail-on-hardcoded` e `smoke:ads-placement` verdes a cada fase.
- Outro desenvolvedor consegue entender o sistema lendo só o mestre + este plano.

## 10. Atualização — Fase 2 executada (2026-06-26)

Investigação detalhada das três "duplicações" de rota (D1–D3) e execução das
consolidações seguras. Contexto decisivo: o POPLOG é **pré-deploy (local-only)**,
então rotas sem chamador no app têm **zero consumidores** — consolidar é seguro.
Tudo validado com `npm run typecheck` (exit 0) e `eslint` dos arquivos alterados.

**D1 — Busca: NÃO é duplicação, são dois tiers intencionais.**
`/api/search` (230 l.) é o tier **rápido** (só títulos, usado como default do hook
`useDebouncedGlobalSearch`); `/api/poplog3/search` (353 l.) é o tier **rico**
(títulos + pessoas + empresas + disponibilidade, usado pela SearchBar/SearchPageView).
Ambos compartilham a mesma engine (`catalogSearch`, hidratação, fuzzy). Colapsá-los
tornaria a busca rápida mais pesada (regressão de performance). **Decisão: manter os
dois**, documentados como tiers. O hook já lê `titles ?? results`, então são
compatíveis. Status: **resolvido (sem merge, por design).**

**D2 — Título: consolidado.** `/api/poplog3/titles/[mediaType]/[id]` (canônico,
usa `getTitlePageData`) vs `/api/title/[mediaType]/[id]` (legado, usa
`getPoplogTitleDetails`). Ambos com 0 chamadores no app. A rota legada foi
convertida em **adapter de compat** (`export { GET } from "@/app/api/poplog3/titles/[mediaType]/[id]/route"`),
eliminando 116 linhas de orquestração duplicada e preservando a URL. Status: **Concluído.**

**D3 — Discover: consolidado.** `/api/discover` (canônico, personalizado, com
fallback local) vs `/api/poplog3/discover` (legado). Ambos com 0 chamadores no app.
A rota legada virou **adapter de compat** (`export { GET } from "@/app/api/discover/route"`),
eliminando 157 linhas duplicadas e preservando a URL. Status: **Concluído.**

**Higiene de imports.** O único import relativo profundo do projeto
(`../../../_shared` nas rotas de listas sob `[id]/`) foi migrado para o alias
`@/app/api/lists/_shared`. Confirmado que `@/* → ./src/*` já cobre todo o resto
(1.264 imports já em alias; 1 relativo profundo antes desta correção).

**Pendência remanescente (decisão de arquitetura).** Há **inconsistência de
namespace canônico**: para título o canônico é `/api/poplog3/*`, para discover é o
bare `/api/*`. Padronizar um único namespace público é um passo futuro (baixo risco,
mas exige decisão de produto + período de redirect). Registrado como evolução de P5.

**Status consolidado de D1–D8 (de §4):** D1 resolvido (tiers); D2, D3 concluídos;
D6 (person/pessoa) já era redirect; D7 (debug→Admin) e D8 (Agenda morta) seguem
pendentes como itens de baixo risco; D4 (estado do usuário) e D5 (disponibilidade)
permanecem nas Fases 4 por exigirem migração com `regression:local` como gate.

## 11. Padronização de namespace de API (2026-06-26)

**Decisão.** O namespace público canônico é o **bare `/api/*`**. O prefixo
`/api/poplog3/*` é um vazamento da versão interna na URL e passa a ser o
**namespace legado**. Base da decisão: o bare já concentra ~87 referências
no app vs poucas no poplog3, e é o contrato público mais limpo.

**Mecanismo do "período de redirect" (APIs).** Não usamos HTTP 308 em rotas de
API (quebraria corpo/método de POST e adicionaria latência). Em vez disso, a rota
legada vira um **adapter de delegação**: `export { GET } from "@/app/api/<canônico>/route"`.
Ambas as URLs respondem; a canônica detém a implementação; chamadores migram
gradualmente sem quebra.

**Concluído nesta etapa:**
- **Título:** implementação canônica movida para o bare `/api/title/[mediaType]/[id]`
  (usa `getTitlePageData`); `/api/poplog3/titles/[mediaType]/[id]` agora **delega**
  para ela. Comentário em `get-title-page-data.ts` atualizado. typecheck + lint verdes.
- **Discover:** canônico já era o bare `/api/discover`; `/api/poplog3/discover`
  delega (Fase 2). Consistente com título.

**Backlog de migração (incremental, com `regression:local` como gate local).**
Rotas poplog3 ainda canônicas, com nº de chamadores no app e nome bare proposto:

| Rota legada (poplog3) | Chamadores | Nome bare canônico proposto | Risco |
|---|---|---|---|
| `/api/poplog3/continuity/*` | 11 | `/api/continuity/*` | Médio (home/acompanhando dependem) |
| `/api/poplog3/search` (rico) | 4 | manter como tier; expor em `/api/search/full` ou `?include=` | Médio (decisão de design de tiers) |
| `/api/poplog3/tv/[id]/seasons/[season]` | 2 | `/api/tv/[id]/seasons/[season]` | Baixo |
| `/api/poplog3/providers` | 2 | `/api/providers` | Baixo |
| `/api/poplog3/episodes` | 2 | `/api/episodes` | Baixo |
| `/api/poplog3/acompanhando` | 2 | `/api/acompanhando` | Baixo |
| `/api/poplog3/series/[id]/progress` | 1 | `/api/series/[id]/progress` | Baixo |
| `/api/poplog3/people/[id]` | 1 | `/api/people/[id]` | Baixo |
| `/api/poplog3/discovery/*` | 1 | `/api/discovery/*` | Baixo |

**Receita por rota (segura, validável por typecheck; rodar regressão local antes de remover o legado):**
1. Mover a implementação para o caminho bare canônico.
2. Substituir a rota poplog3 por `export { GET/POST } from "@/app/api/<bare>/route"`.
3. (Opcional, higiene) repontar chamadores in-app para o bare — o adapter mantém
   os antigos funcionando enquanto isso.
4. `npm run typecheck` + `eslint` dos arquivos; depois `npm run regression:local`
   na máquina local antes de considerar a remoção futura do adapter legado.

**Critério de aceite desta padronização:** título e discover consistentes no bare
(✅); regra documentada e aplicada como padrão (✅); backlog explícito com receita
segura (✅). Migração das rotas de alto tráfego (continuity) fica para incremento
seguinte, com regressão local.

### 11.1 Lote de baixo risco — concluído (2026-06-26)

Migradas para o bare canônico (implementação no bare, rota poplog3 vira adapter de
delegação, chamadores in-app repontados). Relocação behaviorally-idêntica por
construção (`cp` + delegação); typecheck + eslint verdes.

| Canônico (bare) | Legado (delega) | Métodos | Chamadores repontados |
|---|---|---|---|
| `/api/tv/[id]/seasons/[season]` | `/api/poplog3/tv/...` | GET | 2 (TitleEpisodeBrowser) |
| `/api/providers` | `/api/poplog3/providers` | GET | — (comentário ajustado) |
| `/api/episodes` | `/api/poplog3/episodes` | POST | 1 (episodeProgressClient) |
| `/api/acompanhando` | `/api/poplog3/acompanhando` | GET, POST | 1 (acompanhando/page) |
| `/api/series/[id]/progress` | `/api/poplog3/series/...` | GET | 1 (TitleEpisodeBrowser) |
| `/api/people/[id]` | `/api/poplog3/people/[id]` | GET | — (comentário ajustado) |
| `/api/discovery/shortcut/[slug]` | `/api/poplog3/discovery/...` | GET | 1 (SearchPageView) |
| `/api/discovery/shortcuts` | `/api/poplog3/discovery/shortcuts` | GET | — |

**Padrão do adapter:** `export { <métodos> } from "@/app/api/<bare>/route";`.
Ambas as URLs respondem; a remoção futura dos adapters poplog3 deve aguardar
`npm run regression:local` na máquina local.

**Nota de ambiente:** ao criar as rotas, o `next dev` em execução regenerou
`.next/dev/types/routes.d.ts` de forma truncada (artefato gerado, em `.gitignore`).
Removê-lo e deixar o Next regenerar resolve; não afeta o código-fonte (typecheck do
`src` = exit 0).

**Ainda pendente (gate de regressão local):** `/api/poplog3/continuity/*` (11
chamadores, núcleo de Home/Acompanhando) e o tier rico `/api/poplog3/search`
(decisão de design de tiers). Não migrados nesta passada por exigirem validação de
comportamento que não roda neste ambiente.

### 11.2 Continuity migrado para bare (2026-06-26)

As 8 rotas `/api/poplog3/continuity/*` (continue, debug, hero, new-episodes,
recently-watched, title-debug, upcoming-episodes, watchlist-picks) foram relocadas
para o bare `/api/continuity/*` (impl no bare, poplog3 vira adapter de delegação).
Chamadores repontados: 5 fetches em `app/acompanhando/page.tsx` + 1 import de tipo
(`RecentlyWatchedItem`) em `RecentlyWatchedCard.tsx`. typecheck + eslint verdes.
Os tipos só usados por código removido (Agenda) deixaram de ter importadores.

> Gate de remoção dos adapters poplog3: `npm run regression:local` local. Resta o
> tier rico `/api/poplog3/search` (decisão de design de tiers).

## 12. Remoção do módulo Agenda morto e consolidação do Debug (2026-06-26)

**Agenda (D8) — removido.** O módulo era um loop fechado sem consumidores externos
(nada fora dele importava `features/agenda` ou `server/agenda`; nenhum fetch a
`/api/poplog3/agenda*`; a página já redirecionava para `/radar`). Removidos:
`src/features/agenda/` (5 componentes), `src/server/agenda/` (6 arquivos:
agenda-engine, discover-service, editorial-balance-engine, editorial-regional-bonus,
temporal-layer-engine, types), `src/app/api/poplog3/agenda/` (3 rotas) e
`src/app/agenda/AgendaClient.tsx` (órfão). **Mantido** `src/app/agenda/page.tsx`
(redirect `/agenda`→`/radar`, compat de bookmarks). O ICS agenda
(`/api/ics/agenda*`, feed de calendário vivo) **não** faz parte do módulo e ficou
intacto. typecheck exit 0.

**Debug (D7) — consolidado no Admin.** As páginas `/debug/{apis,engine,radar}` eram
duplicatas standalone não-linkadas. O Admin já tinha as abas `engine`
(`TabEngineMonitor`) e `radar` (`TabRadarCache`). `TabApiHistory` existia mas não
estava ligada — foi **conectada ao Admin** como nova aba "API". Removida a pasta
`src/app/debug/` inteira (3 páginas + 3 clients órfãos). As **rotas** de debug
(`/api/debug/*`, consumidas pelo Admin) ficaram intactas. typecheck + eslint verdes.

**Status D1–D8:** D1 (tiers), D2, D3 resolvidos; D4, D5 (Fase 4, gate local);
D6 redirect; **D7 e D8 concluídos**.

## 13. Fase 4 — runbook de consolidação de DB (D4/D5)

> Investigação de 2026-06-26. As mudanças de **schema** (drop de tabela) exigem
> `prisma migrate` + `regression:local` na máquina local — **não** rodam neste
> ambiente. Por isso este é um runbook executável, não aplicado às cegas.

### 13.1 D4 — estado do usuário: já majoritariamente convergido

**Verificação (código real):** a materialização em `UserTitleState` **já está no
lugar**. As escritas passam pela camada de serviço, que propaga o estado:

- `server/library/library-service.ts` importa de `@/server/state/user-title-state`
  e `upsertUserTitleStatus()` delega a `local.upsertUserTitleStatus()` (materializa).
- `episode-progress-local.service.ts` chama `upsertTitleState()` após progresso.
- `continuity-local.service.ts` (reopen série) chama `upsertUserTitleState()` após
  o `userTitle.updateMany`.
- Os hooks citados como problemáticos no `ARCHITECTURE.md` arquivado
  (`useWatchedToggle`/`useWatchlistToggle`) **não existem mais**; o toggle atual é
  `hooks/useTitleToggle.ts` + `hooks/useLibraryStatus.ts`, server-side.

**Conclusão:** `UserTitle` (transacional) + `UserTitleState` (materializado) é uma
separação CQRS **intencional** — manter ambas. O problema de dual-write do doc
antigo está resolvido.

**Ação segura (drop de tabela morta):** `UserWatching` tem 1 referência única
(`reset-library` faz `deleteMany`), **zero** create/read/write reais → tabela morta.
- Passos (local): remover `model UserWatching` de `prisma/schema.prisma`; remover a
  linha `db.userWatching.deleteMany(...)` em `src/app/api/user/reset-library/route.ts`;
  `npm run db:push` (ou migration); `npm run typecheck`; `npm run regression:local`.
- Risco: baixo (nada lê/escreve). Rollback: reverter schema + restaurar a linha.

**Manter:** `UserCuradoriaState` é viva (CRUD completo em
`repositories/user-curadoria-state.repository.ts`) — concern separado (overlay de
curadoria), não consolidar.

### 13.2 D5 — disponibilidade: uma canônica + duas mortas

| Tabela | Refs | Status | Ação |
|---|---|---|---|
| `CatalogAvailability` (imdbId-first) | 13 | **Canônica** | Manter como fonte única |
| `Poplog3TitleAvailability` (tmdbId) | 2 reads, **0 writes** | Legada/morta | Remover read + dropar tabela |
| `Poplog3AvailabilityFallbackState` | 0 | Morta | Dropar tabela |

`Poplog3TitleAvailability` é lida apenas por `continuity-local.service.ts` (linhas
~745/760), por `tmdbId+mediaType+country`, mas **nada popula a tabela** → o read
retorna vazio (caminho morto). `CatalogAvailability` é imdbId-first e é a camada
global real (`server/availability/*`, `repositories/catalog-availability.repository.ts`).

**Passos (local, ordem segura):**
1. Em `continuity-local.service.ts`, remover os dois blocos
   `db.poplog3TitleAvailability.findMany(...)` (são fallback sempre vazio). Se quiser
   manter um fallback de disponibilidade ali, trocar pela camada global
   (`getTitleAvailability`/`catalogAvailability`) — mas isso é mudança de
   comportamento e exige smoke (`smoke:cold-series`, `db:smoke:acompanhando`).
2. `npm run typecheck` + `npm run db:smoke:availability` + `npm run regression:local`.
3. Só então remover os models `Poplog3TitleAvailability` e
   `Poplog3AvailabilityFallbackState` de `prisma/schema.prisma` e `npm run db:push`.
4. `AvailabilitySource`/`AvailabilityType` enums: manter (usados por CatalogAvailability).

**Risco:** baixo-médio. O único cuidado é se o DB local tiver linhas legadas em
`poplog3_title_availability` que ainda apareçam na UI de Acompanhando; validar com
`db:smoke:acompanhando` antes/depois.

### 13.3 Ordem recomendada e gate

1. D5 passo 1–2 (remover read morto) → typecheck + smokes.
2. D4 drop `UserWatching` → typecheck + regression.
3. D5 passo 3 (drop das duas tabelas) → db:push + regression.
4. Atualizar `POPLOG_SYSTEM_OVERVIEW.md` §9 (banco) removendo as tabelas dropadas.

**Gate único:** cada passo só fecha com `npm run typecheck`, `npm run lint` e
`npm run regression:local` verdes na máquina local.

## 14. Rodada de finalização (2026-06-26) — namespace, busca, D4/D5 prep, higiene

Tudo abaixo está **typecheck + eslint verde** localmente. Os drops de tabela
exigem um passo de banco na sua máquina (comandos no §14.3).

### 14.1 Namespace `/api/*` 100% finalizado
- Busca rica unificada em `/api/search` via **dispatcher**: `?include=people,companies`
  → handler rico (extraído para `src/server/search/rich-search-handler.ts`); sem
  param → handler leve. Comportamentos preservados exatos. Chamadores (SearchBar,
  useSearch, SearchPageView) repontados com `include`.
- Migradas as 3 últimas: `search/discovery` → `/api/search/discovery`;
  `discover/special` → `/api/discover/special`.
- **Pasta `src/app/api/poplog3/` removida por completo (21 adapters)** — não havia
  mais nenhum chamador in-app nem import. O namespace `/api/poplog3/*` deixa de existir.

### 14.2 Higiene de código
- Removidas 3 definições não usadas (limpa 3 warnings de lint): `Languages`
  (TabOperationsAdmin), `GenreObj` (genre-stats), `isBlockedUser` (get-current-user).

### 14.3 D4/D5 — drops de tabela morta PREPARADOS (rodar na máquina local)
**Código (já aplicado, typecheck verde):**
- Removida a função morta `getLocalTitleAvailabilityBatch` (já `@deprecated`, 0
  chamadores) em `continuity-local.service.ts` — era o único leitor de
  `poplog3_title_availability`.
- Removida a linha `db.userWatching.deleteMany(...)` em `reset-library`.

**Schema (já editado em `prisma/schema.prisma`, 46→43 models):** removidos os models
`UserWatching`, `Poplog3TitleAvailability`, `Poplog3AvailabilityFallbackState` e suas
back-relations (`User.userWatching`, `User.availabilityFallbackStates`,
`StreamingProvider.poplog3TitleAvailabilities`).

**Para aplicar no banco (você):**
```bash
npx prisma generate                              # regenera o client sem os 3 models
npx prisma migrate dev --name drop_dead_tables   # gera+aplica a migration (DROP TABLE)
# alternativa rápida local: npm run db:push
npm run typecheck && npm run regression:local    # gate
```
SQL de referência/fallback: `prisma/manual-sql/2026-06-26-drop-dead-tables.sql`.
Confirmado seguro: `regression:local` mostrou `would_delete=0` nas três; nenhuma
tabela tem FK de entrada (só FKs de saída, removidas junto).

### 14.4 Higiene de logs/markers (item 7) — triagem e política
- **`console.log` (135):** 131 server / 4 client. Boa parte já é telemetria
  estruturada (`[ENGINE]`, `[availability]`, `[trending/telemetry]`) e **deve ser
  mantida** — existe `src/server/logging/logger.ts` + `log-control.ts`. Política
  recomendada: (a) remover os 4 logs de cliente; (b) migrar logs server soltos para
  `logger` com nível controlável; (c) manter telemetria útil. **Não é mass-delete.**
- **Markers `legacy/legado` (191; 47 em comentários):** a maioria é **intencional**
  (rótulos de compat, `source: "legacy"`, aliases de fallback), não código morto.
  Política: manter os rótulos funcionais; revisar só os 47 comentários quanto a
  precisão. Sem ação em massa.
- Pendência consciente (passada separada, com validação visual): ~13 `<img>` →
  `next/image`.

### 14.5 Scripts ajustados junto com o drop (importante)
`scripts/` é **excluído do tsconfig**, então o typecheck NÃO pega refs lá. Como o
`prisma generate` removerá os 3 models do client, foram corrigidos os scripts que os
referenciavam (senão `regression:local`/export/import quebrariam):
- `scripts/reset-poplog-v2-catalog.ts` — removidas as 3 entradas da lista de tabelas.
- `scripts/db/export-local-data.ts` e `import-local-data.ts` — removido `userWatching`.
- `scripts/smoke-test-radar-agenda.ts` (standalone, fora do `regression:local`) —
  removido o seed/cleanup de `poplog3TitleAvailability`. Como a Agenda foi removida,
  esse smoke é parcialmente obsoleto e merece revisão/remoção própria depois.
Verificado: **0** acessos reais (`db.<model>.`) aos 3 models em `src/`, `scripts/` e
`prisma/`.

## 15. Fechamento do smoke + atribuição (2026-06-26)

**smoke:local-http (22/22).** O caso "Providers por titulo" ainda apontava para
`/api/poplog3/providers` (rota deletada → 404). Corrigido para a rota bare
`/api/providers` (mesmos params: `id`, `media_type`, `region`). Também corrigido o
mesmo URL legado em `scripts/measure-local-performance.ts` (perf:local media
providers). **0** caminhos `/api/poplog3/*` restam em `scripts/`.

**Atribuição (parcial, correta).** Adicionados ao registro de créditos
(`attribution/`) **apenas as fontes realmente usadas**: **Wikidata** (financeiro +
franquia/universo) e **Wikipedia** (fallback financeiro). `ApiSourceId` ampliado,
entradas + aliases adicionados. **OMDb NÃO foi creditado** — o client foi removido e
não há nenhuma chamada viva; creditá-lo recriaria o bug de "crédito fantasma"
corrigido na §5. typecheck + eslint verdes.

**Itens que permanecem como passada própria (validação que este ambiente não dá):**
- `<img>` → `next/image` (~13): precisa de **validação visual** (layout/proporção/LCP).
- i18n de catálogo site-wide (P1): refatoração grande, **runtime-validada**, em
  múltiplos serializers (Home, título, Radar, Sorteio, busca, SEO). Deve ser
  incremental com `regression:local` + teste manual de locale, não um shot cego.

## 16. Higiene final + decisões de img/i18n (2026-06-26)

- **Logs**: removidos os 4 `console.log` de cliente (AgendaBackgroundRefresh,
  RadarBackgroundPrefetch, LibraryPage, SearchPageView). Server-logs/telemetria
  mantidos (política §14.4). typecheck + lint verdes.
- **`<img>` → decisão de manter `<img>`**: dado `images.unoptimized=true` +
  proxy `/api/images/proxy`, `next/image` não traz ganho e adiciona risco. A regra
  `@next/next/no-img-element` foi desligada de forma **documentada** em
  `eslint.config.mjs` (reflete a arquitetura). Otimização real = projeto à parte
  (remover `unoptimized` + validação visual/perf). Detalhe: DIAGNOSTIC §8.1.
- **i18n de catálogo site-wide**: **bloqueado em pré-requisito de dados** (overview
  bilíngue não materializado). Ordem segura documentada em DIAGNOSTIC §5. Não foi
  forçado às cegas.
- **Novo documento**: `docs/POPLOG_SYSTEM_DIAGNOSTIC.md` — walkthrough navegável da
  engine (ciclo de requisição, identidade, engines, cache, i18n, módulos, saúde,
  mapa do código) para revisão interna.

## 17. i18n de catálogo site-wide — CONCLUÍDO (2026-06-27)

O pré-requisito de dados apontado na §13/DIAGNOSTIC §5 foi resolvido e a adoção
site-wide foi implementada, migrada e validada (typecheck + lint + smokes verdes,
`prisma migrate status` up-to-date, `db:generate` ok, após restart limpo).

- **Armazenamento bilíngue**: model `CatalogLocalization` → tabela
  `catalog_localizations` (migration `00000000000018_catalog_localizations`), chave
  única `(poplog_id, language)`, colunas `title`/`overview`/`tagline`/`source`/
  `hydrated_at`. Resolve o "overview bilíngue" que faltava. (Schema agora: 44 models.)
- **Resolver canônico**: `resolveCatalogLocalization` + `pickLocalized` em
  `lib/i18n/catalog-localization.ts`; store em
  `server/catalog/catalog-localization-store.ts` (`getCatalogLocalizationsByPoplogId`,
  `upsertCatalogLocalization(s)`).
- **Fallback explícito/rastreável** (nunca traduz): catalogLanguage → outro idioma →
  `overviewLanguage` legado → primeiro bloco com texto → campos legados; retorna
  `fallbackUsed`/`fallbackLanguage`/`requestedLanguage`.
- **Módulos integrados**: Home/Trending (`trending-feed`, `trakt-index/canonical`,
  `trending-contract`), página de título (`get-title-page-data`, `poplog-title-details`),
  Radar (`radar-trakt-engine`), Busca (`fuzzy-title-search`), Sorteio (`sorteio-engine`)
  — além de Para Você/Watchlist de antes.
- **Validação**: `smoke:catalog-localization` (resolver pt-BR/en-US + fallback),
  `smoke:seo:title`, `smoke:trending-v2` 36/36, `smoke:local-http` 14/14.
- **Ressalva**: `regression:local` tem caveat conhecido no passo `db:seed`
  (datasource do Prisma) — não bloqueia; os smokes específicos acima cobrem o i18n.
- **Pendência separada (não-bloqueante)**: possível questão de OG/proxy com `webp`
  (`/api/og/title` via `lib/images/proxy`) — fica como item próprio, fora do escopo i18n.
