# POPLOG — Relatório de Fechamento da Unificação

> Estado consolidado em 2026-06-26 (branch `feature/sistema-novo`), após
> Fases 1–4. **Validado localmente:** `npm run regression:local` = **23/23 etapas
> verdes** com o app rodando em `localhost:3000` (inclui HTTP, SEO e perf).
> Documentos relacionados: `../POPLOG_SYSTEM_OVERVIEW.md` (fonte de verdade),
> `POPLOG_GLOBAL_UNIFICATION_PLAN.md` (plano detalhado, §1–13).

## 1. O que foi REMOVIDO

**Código morto / barrels / órfãos (Fase 1):**
- `src/server/index.ts` — barrel sem nenhum importador.
- `src/server/strategies/api-priority.ts` — config morta e desatualizada (TMDB/Watchmode/MotN).
- 10 diretórios órfãos vazios: `api-clients/omdb`, `api-clients/tvdb`, `lib/episodes`,
  `api/admin/tmdb-feed-toggle`, `api/debug/{balloonerismm,movieofthenight,omdb,tmdb,watchmode}`,
  `api/dev/pt-br-probe`.

**Módulo Agenda morto (15 arquivos, Fase 3):** loop fechado sem consumidores externos.
- `src/features/agenda/` (5 componentes), `src/server/agenda/` (6: agenda-engine,
  discover-service, editorial-balance-engine, editorial-regional-bonus,
  temporal-layer-engine, types), `src/app/api/poplog3/agenda/` (3 rotas),
  `src/app/agenda/AgendaClient.tsx` (órfão).
- **Mantido:** `src/app/agenda/page.tsx` (redirect `/agenda`→`/radar`, compat).
- **Intacto:** `/api/ics/agenda*` (feed de calendário vivo — não é o módulo).

**Páginas de debug (6 arquivos, Fase 3):** `src/app/debug/{apis,engine,radar}/`
(3 páginas + 3 clients), duplicatas standalone não-linkadas. Engine e Radar já
existiam como abas do Admin; `TabApiHistory` foi **ligada** ao Admin como aba "API".
- **Intacto:** `/api/debug/*` (endpoints consumidos pelo Admin).

**Documentação (Fase 0):** 11 documentos superados movidos para `docs/archive/`;
raiz do repo limpa (só `README.md`, reescrito).

## 2. O que foi MIGRADO para o bare `/api/*` (namespace canônico)

Regra: o público canônico é o bare `/api/*`; `/api/poplog3/*` é legado. **18 rotas**
com implementação agora no bare:

| Domínio | Bare canônico | Métodos |
|---|---|---|
| Título | `/api/title/[mediaType]/[id]` | GET |
| Discover | `/api/discover` | GET |
| Providers | `/api/providers` | GET |
| Episodes | `/api/episodes` | POST |
| Acompanhando | `/api/acompanhando` | GET, POST |
| People | `/api/people/[id]` | GET |
| Series progress | `/api/series/[id]/progress` | GET |
| TV seasons | `/api/tv/[id]/seasons/[season]` | GET |
| Discovery | `/api/discovery/shortcut/[slug]`, `/api/discovery/shortcuts` | GET |
| Continuity (8) | `/api/continuity/{hero,continue,new-episodes,recently-watched,watchlist-picks,upcoming-episodes,debug,title-debug}` | GET |

Todos os chamadores in-app foram repontados para o bare; **0 chamadores** restantes
nas rotas poplog3 migradas.

## 3. O que ficou como ADAPTER TEMPORÁRIO

**18 rotas `/api/poplog3/*`** viram adapters de delegação de 1 linha
(`export { GET/POST } from "@/app/api/<bare>/route"`). Ambas as URLs respondem; a
remoção dos adapters é decisão futura (sem consumidores in-app, mas mantidos por
segurança de compat).

**Ainda com implementação no poplog3 (NÃO migradas — decisão de design/escopo):**
- `/api/poplog3/search` e `/api/poplog3/search/discovery` — **tier rico** de busca
  (títulos + pessoas + empresas). `/api/search` é o tier leve. Manter os dois é
  intencional (fundir regrediria performance da busca instantânea).
- `/api/poplog3/discover/special` — discover especial, ainda não migrado.

## 4. O que foi VALIDADO por `regression:local` (23/23)

Confirmado verde com app local: `db:seed`, `db:reset:catalog:dry`, sorteio
(seed-minimum, minimum-pool, local-draw), `library-state`, `library-identity`,
`episode-progress`, `admin-user-access`, providers (commercial-fixtures,
normalization), `availability`, `availability-stale`, `assets-local`,
`cold-series`, `refresh-queue`, `workers:cron`, `redis`, **`audit:i18n`**,
**`smoke:ads-placement`**, **`smoke:seo:title`**, **`smoke:local-http`**,
**`perf:local`**.

> Impacto direto: os smokes de biblioteca, estado, episódios, availability,
> cold-series e acompanhando exercitam exatamente os caminhos afetados pela
> migração de continuity, remoção do Agenda e adapters — **sem regressão**.

## 5. BACKLOG real (não feito nesta rodada, por segurança/escopo)

**Drops de tabelas mortas (DB — runbook no plano §13):**
- `UserWatching` (1 ref, só `deleteMany` no reset; 0 escritas reais).
- `Poplog3TitleAvailability` (2 reads, **0 escritas** — `continuity-local` lê tabela
  não populada) e `Poplog3AvailabilityFallbackState` (0 refs).
- Canônica de disponibilidade = `CatalogAvailability` (imdbId-first).
- Exige `prisma migrate`/`db:push` + `regression:local` como gate. Confirmado no
  log de regressão: ambas as tabelas mortas mostram `would_delete=0`.

**Namespace — fim da migração:**
- Decidir destino bare do tier rico de busca (ex.: `/api/search/full` ou `?include=`)
  e migrar `/api/poplog3/discover/special`.
- Remover os 18 adapters poplog3 quando não houver mais consumidores externos.

**Qualidade de código (warnings de lint — 16, todos 0-erro):**
- 3 imports não usados: `Languages` (TabOperationsAdmin), `GenreObj` (genre-stats),
  `isBlockedUser` (get-current-user). Limpeza trivial typecheck-safe.
- ~13 `<img>` → `next/image` (LCP/banda). **Adiado para passada separada com
  validação visual** (decisão do produto).

**Internacionalização e atribuição:**
- Localização de catálogo site-wide (hoje Trending V2 + parcial Para Você).
- Overview/sinopse bilíngue no banco (hoje pode cair em pt-BR).
- Atribuir Wikidata/Wikipedia/OMDb na UI (exige ampliar `ApiSourceId`).

**Higiene:**
- ~135 `console.log` e ~205 marcadores `legacy` a revisar.

**Risco maior (já no plano, Fase 4+):** nada estrutural pendente — `UserTitle`+
`UserTitleState` é split CQRS intencional com materialização já propagada (verificado).

---

## Atualização — rodada de finalização (2026-06-26)

Mudanças após o fechamento inicial (typecheck + eslint verde; gate de banco abaixo):

**Namespace `/api/*` 100% concluído.** A pasta `src/app/api/poplog3/` foi **removida
por inteiro** (21 adapters, 0 chamadores). A "ponte temporária" descrita na §3 deixou
de existir — não há mais `/api/poplog3/*`. A busca rica foi unificada em
`/api/search?include=people,companies` (dispatcher; handler rico em
`src/server/search/rich-search-handler.ts`), e `search/discovery` + `discover/special`
migraram para o bare.

**Higiene de código.** Removidas as 3 definições não usadas (`Languages`, `GenreObj`,
`isBlockedUser`) — 3 warnings de lint a menos.

**D4/D5 — preparado para você rodar.** Código morto removido (função
`getLocalTitleAvailabilityBatch`, linha `userWatching.deleteMany`) e `schema.prisma`
editado (46→43 models: removidos `UserWatching`, `Poplog3TitleAvailability`,
`Poplog3AvailabilityFallbackState` + back-relations). Falta só o passo de banco na
sua máquina (`prisma generate` + `prisma migrate dev --name drop_dead_tables` +
`regression:local`). Detalhe e SQL: PLAN §14.3.

**Backlog que permanece:** `<img>`→`next/image` (~13, passada visual separada);
i18n de catálogo site-wide + overview bilíngue + atribuição Wikidata/Wikipedia/OMDb;
triagem fina de logs (a política está no PLAN §14.4 — a maioria é telemetria/compat
intencional, não mass-delete).
