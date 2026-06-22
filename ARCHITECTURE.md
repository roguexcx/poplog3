# POPLOG V3 — Arquitetura Global

> Documento de referência arquitetural. Criado a partir de auditoria completa da codebase em Mai/2026.
> Atualizar sempre que um sistema crítico for modificado.

---

## 1. Premissa desta versão

POPLOG V3 é construída sobre uma **engine de estado materializado** centrada na tabela `user_title_state`. Toda leitura de dados para exibição deve partir dali. Toda escrita de evento deve propagar para lá via `upsertTitleState()`.

O ecossistema inteiro — Home, Agenda, Biblioteca, Página de Título, Acompanhando — deve consumir os mesmos sinais globais, sem estados paralelos ou derivações locais.

---

## 2. Diagrama de fluxo de dados

```
AÇÃO DO USUÁRIO
  │
  ├─► API Route (Next.js)
  │       │
  │       ├─► user_titles          ← escrita de status/favorite/liked
  │       ├─► user_episodes        ← escrita de episódios assistidos
  │       └─► upsertTitleState()   ← OBRIGATÓRIO após qualquer escrita
  │                   │
  │                   └─► user_title_state   ← FONTE DE VERDADE (materializada)
  │
LEITURA DA UI
  │
  ├─► /api/poplog3/continuity/hero         → user_title_state
  ├─► /api/poplog3/continuity/continue     → user_title_state
  ├─► /api/poplog3/continuity/new-episodes → user_title_state
  ├─► /api/poplog3/agenda                  → user_title_state
  ├─► /api/library                         → user_title_state
  └─► /api/poplog3/acompanhando (legacy)   → user_titles (MIGRAR)
```

---

## 3. Tabelas do banco de dados

### 3.1 `user_title_state` — Fonte de verdade (V3)

Tabela materializada. Calculada e mantida pelo servidor após todo evento de escrita.
**Nunca lida diretamente pelo cliente.**

| Campo | Tipo | Descrição |
|---|---|---|
| `user_id` | UUID | FK do usuário |
| `tmdb_id` | int | ID do TMDB |
| `media_type` | `movie\|tv` | Tipo de mídia |
| `status` | string | Status de biblioteca (watchlist, watched, etc.) |
| `computed_state` | `ComputedState` | Estado visual derivado — o que a UI exibe |
| `watched_episodes` | int | Episódios assistidos (TV) |
| `aired_episodes` | int | Episódios já exibidos (TV) |
| `progress_pct` | int | Percentual de progresso (0–100) |
| `next_season` | int | Próxima temporada a assistir |
| `next_episode` | int | Próximo episódio a assistir |
| `next_episode_air_date` | string | Data de exibição do próximo episódio |
| `last_watched_at` | string | Último acesso |
| `watched_keys` | string[] | Chaves de episódios assistidos |
| `franchise_tmdb_id` | int | ID da coleção TMDB (filmes) |
| `franchise_watched` | int | Filmes da franquia assistidos |
| `franchise_total` | int | Total de filmes na franquia |
| `best_provider_name` | string | Melhor plataforma disponível |
| `best_provider_type` | string | `subscription\|rent\|buy` |
| `best_provider_logo` | string | Logo da plataforma |

**`ComputedState` — valores possíveis:**

| Valor | Condição (TV) | Condição (Filme) |
|---|---|---|
| `watchlist` | Salvo, sem episódio assistido | Status = watchlist |
| `in_progress` | Tem progresso, há aired não vistos | Status = watching |
| `up_to_date` | Em dia, série ainda em produção | — |
| `completed` | Em dia + série encerrada; ou watched manual | — |
| `watched` | — | Status = watched |
| `abandoned` | Status = abandoned | Status = abandoned |
| `fridge` | Status = fridge | Status = fridge |

### 3.2 `user_titles` — Registro de biblioteca (V2/transacional)

Tabela de origem das ações do usuário. Contém o registro bruto do que o usuário declarou.
`user_title_state` é derivado dela + `user_episodes` + TMDB metadata.

| Campo | Tipo | Descrição |
|---|---|---|
| `status` | string | watchlist, watched, watching, abandoned, fridge |
| `favorite` | bool | Favorito |
| `liked` | bool\|null | Avaliação |
| `title` | string | Título (cache local) |
| `release_year` | int | Ano (cache local) |
| `stream_status` | string | Status de streaming (legacy, migrar para `user_title_state`) |

### 3.3 `user_episodes`

Registro de episódios assistidos por usuário. Alimenta `computeUserSeriesProgress()`.

### 3.4 `user_title_feedback`

Feedback explícito do usuário por título. Alimenta o sistema de curadoria/exclusão.

| Tipo | Efeito |
|---|---|
| `not_interested` | Exclui da curadoria e recomendações |
| `liked` / `disliked` | Afeta scoring de gênero |
| `hidden` | Esconde da biblioteca |
| `dismissed_from_section` | Remove de seção específica |
| `boosted` | Eleva no scoring |

### 3.5 `poplog3_curadoria_overlay`

Overlay por título/usuário para a engine de curadoria. Armazena snooze, contagem de exibições no hero.

### 3.6 `user_events`

Log imutável de eventos do usuário. Fire-and-forget, não bloqueia operações.

---

## 4. Engine central — `upsertTitleState()`

**Arquivo:** `src/server/state/user-title-state.ts`

Função central que deve ser chamada após **todo** evento de escrita no ecossistema.

```
Evento (episódio/status/clear)
  └─► upsertTitleState({ userId, tmdbId, mediaType, event?, seriesProgress?, libraryEntry? })
          │
          ├─► fetchLibraryEntry()     → user_titles   (se não fornecido)
          ├─► fetchTitleMeta()        → poplog3_titles
          ├─► computeUserSeriesProgress() → user_episodes  (TV, se não fornecido)
          ├─► computeFranchiseProgress()  → user_titles + poplog3_titles (filme com franquia)
          │
          └─► upsert user_title_state
                  └─► logUserEvent()  → user_events (fire-and-forget)
```

**Regra obrigatória:** Todo API route que escreve em `user_titles` ou `user_episodes` deve chamar `upsertTitleState()` logo após. Pode ser fire-and-forget (`upsertTitleState(...).catch(console.error)`), mas **não pode ser omitido**.

**Otimização:** Quando o caller já calculou progresso ou carregou o entry de biblioteca, passe via `seriesProgress` e `libraryEntry` para evitar re-queries redundantes.

---

## 5. Providers e estado global

### 5.1 `UserDataContext` — LEGACY (uso restrito)

**Arquivo:** `src/context/UserDataContext.tsx`

Lê integralmente `user_titles` do cliente legado. Rerenderiza toda vez que `poplog:user-titles-updated` é disparado.

**Usado atualmente por:**
- `HomeMemberSections` → envolve `ForYouSection` e `WatchlistVivaSection`
- `ForYouSection` — usa `titles` para decidir se busca `/api/user/for-you`
- `WatchlistVivaSection` — filtra `titles` por `status === "watchlist"`

**Problema estrutural:**
1. Lê `user_titles` inteiro (sem filtro), não `user_title_state`
2. Não tem acesso a `computed_state`, `progress_pct`, `next_episode`, etc.
3. `WatchlistVivaSection` escreve diretamente em `user_titles` via cliente legado sem chamar `upsertTitleState()` — cria gap de sincronização

**Plano de migração:** Substituir por um provider que consome `/api/poplog3/continuity/watchlist-picks` e o próprio estado de `user_title_state`. Eliminar `UserDataContext` após migração da Home.

### 5.2 Não existe provider global V3 ainda

O estado V3 é lido por página via API routes. Não existe um provider React global que exponha `user_title_state`. Cada seção faz seu próprio fetch.

**Implicação:** Ações em uma página não propagam automaticamente para outras seções abertas na mesma sessão. O ciclo atual é: ação → escrita no banco → refresh manual (evento `poplog:user-titles-updated` ou reload).

---

## 6. Hooks de toggle (padrão de escrita)

Todos os hooks de toggle herdam do mesmo padrão base em `useTitleToggle<T>()`.

| Hook | Arquivo | Lê | Escreve |
|---|---|---|---|
| `useWatchedToggle` | `src/hooks/useWatchedToggle.ts` | `isTitleWatched()` | `toggleWatched()` → `user_titles` |
| `useWatchlistToggle` | `src/hooks/useWatchlistToggle.ts` | `isTitleInWatchlist()` | `toggleWatchlist()` → `user_titles` |
| `useUserFeedbackToggle` | `src/hooks/useUserFeedbackToggle.ts` | `/api/user/feedback` GET | `/api/user/feedback` POST/DELETE |

**Problema crítico:** `useWatchedToggle` e `useWatchlistToggle` chamam `user-title-service.ts` que escrevia **diretamente pelo cliente legado** (não via API route). Isso significa que `upsertTitleState()` **não é chamado** após essas ações. A `user_title_state` fica desatualizada até o próximo evento vindo do servidor.

**Solução necessária:** Migrar esses toggles para chamar API routes server-side que chamem `upsertTitleState()` após a escrita.

---

## 7. Sistemas por página

### 7.1 Home

**Arquivo:** `src/features/home/HomePage.tsx`

```
HomePage (Server Component)
  ├─► getTrending()          → TMDB trending
  ├─► getFeaturedDetails()   → TMDB details
  ├─► HeroSection            → Hero estático baseado em trending (não personalizado)
  └─► HomeMemberSections     → Client Component
          └─► UserDataProvider (wraps UserDataContext)
                  ├─► ForYouSection
                  │       ├─► useUserData() → user_titles (LEGACY)
                  │       └─► POST /api/user/for-you com a lista de títulos
                  └─► WatchlistVivaSection
                          ├─► useUserData() → user_titles (LEGACY)
                          └─► POST /api/watchlist/live para enriquecer
```

**O Hero da Home é diferente do HeroSpotlight personalizado.** O Hero da Home exibe trending do TMDB. O HeroSpotlight personalizado (curadoria) vive na seção de Acompanhando.

**Sinais consumidos:** `user_titles` via `UserDataContext` (legacy).

### 7.2 HeroSpotlight / Acompanhando

**Arquivo:** `src/hooks/useCuradoriaEngine.ts`

```
useCuradoriaEngine()
  ├─► GET /api/poplog3/acompanhando → user_titles + poplog3_episodes + curadoria_overlay
  ├─► calculatePriorityScore()      → scoring client-side (curadoria-engine.ts)
  └─► selectHeroItems()             → seleção final com restrições de diversidade
```

**Problema:** O `/api/poplog3/acompanhando` usa `user_titles` (não `user_title_state`) como fonte de dados. Lê episódios, progresso e overlay manualmente, recriando lógica que já existe em `user_title_state`.

**Solução de longo prazo:** Migrar `/api/poplog3/acompanhando` para ler de `user_title_state` + `poplog3_curadoria_overlay`, eliminando as joins manuais.

### 7.3 Hero de Continuidade (`/api/poplog3/continuity/hero`)

**Arquivo:** `src/app/api/poplog3/continuity/hero/route.ts`

O sistema mais maduro. Consome `user_title_state` via `getHeroCandidates()`.
Implementa cache em memória com LRU (TTL fresh: 90s, stale: 8min, max: 1000 entries).
Após seleção, enriquece com dados de episódio via `getCachedEpisode()` e registra impressões via `recordHeroImpressions()`.

**Sinais consumidos:** `user_title_state` (V3, correto).

### 7.4 Agenda (`/api/poplog3/continuity/new-episodes`)

**Arquivo:** `src/app/api/poplog3/continuity/new-episodes/route.ts`

Filtra `user_title_state` por `computed_state IN ('in_progress', 'up_to_date')` com `new_episode_air_date` já aired.

**Sinais consumidos:** `user_title_state` (V3, correto).

### 7.5 Biblioteca

**Arquivo:** `src/server/library/library-service.ts`

Lê de `user_title_state` com filtros por `status` e `computed_state`. Sistema mais alinhado com V3.

**Sinais consumidos:** `user_title_state` (V3, correto).

### 7.6 Página de Título

**Arquivos:** `src/features/title/TitlePageView.tsx`, `TitleActions.tsx`, `TitleEpisodeBrowser.tsx`

Usa `useWatchedToggle`, `useWatchlistToggle`, e o sistema de episódios. Lê estado inicial via `readTitleState()`.

**Problema:** As ações de toggle na página de título (`useWatchedToggle`, `useWatchlistToggle`) escrevem em `user_titles` sem chamar `upsertTitleState()`. Apenas o toggle de episódio (via `TitleEpisodeBrowser`) provavelmente chama a rota correta.

---

## 8. Engine de curadoria e scoring

**Arquivo:** `src/lib/curadoria-engine.ts`

### Fórmula de score

```
score = (f1×22 + f2×20 + f3×18 + f4×12 + f5×10 + f6×8 + f7×7 + f8×8) × status_multiplier + f9×10
```

| Fator | Nome | Peso | Descrição |
|---|---|---|---|
| f1 | Recência | 22 | Horas desde `last_watched_at` |
| f2 | Urgência | 20 | Progresso (filme) ou eps faltando (série) |
| f3 | Novo episódio | 18 | Horas desde `new_episode_available_since` |
| f4 | Streaming | 12 | Dias desde disponibilidade em plataforma |
| f5 | Qualidade | 10 | (rating - 5) / 5 |
| f6 | Duração | 8 | Tempo restante vs `preferred_session_duration` |
| f7 | Gênero | 7 | Overlap com `top_genres` do usuário |
| f8 | Frescor | 8 | Penalidade por exibições recentes no hero |
| f9 | Redescoberta | +10 | Bônus aditivo para conteúdo esquecido |

**Multiplicadores de status:** watching ×1.0, paused ×0.85, watchlist ×0.60, abandoned ×0.15

### Restrições de diversidade (`selectHeroItems`)

- Máx 3 séries
- Máx 3 filmes
- Máx 1 item em watchlist
- Máx 2 por plataforma de streaming

---

## 9. Disponibilidade de streaming

**Arquivos:** `src/server/streaming/availability-service.ts`, `resolve-availability.ts`

A disponibilidade é sincronizada em batch job e salva em `user_title_state` nos campos `best_provider_*`.
Atualização incremental via `refreshTitleStateAvailability()`.

O sistema calcula o "melhor provedor" considerando `user_streaming_preferences` do usuário (priority_order, is_enabled, country).

---

## 10. Problemas arquiteturais identificados

### 🔴 CRÍTICO — Dois sistemas de estado paralelos

`user_titles` (V2) e `user_title_state` (V3) coexistem. Mudanças em `user_titles` via client-side (`user-title-service.ts`) não propagam para `user_title_state`.

**Efeito:** Hero, Acompanhando, Biblioteca exibem estado desatualizado após ações de toggle na Página de Título ou ForYouSection.

**Solução:** Migrar todos os toggles para API routes que chamem `upsertTitleState()` após cada escrita.

### 🔴 CRÍTICO — WatchlistVivaSection escreve em user_titles sem upsertTitleState

**Arquivo:** `src/features/home/components/WatchlistVivaSection.tsx:412-425`

Ao marcar um título como watched ou remover da watchlist diretamente nos cards da Home, o componente escrevia diretamente via cliente legado. `upsertTitleState()` não é chamado. `user_title_state` fica desatualizada.

### 🟡 ALTA — /api/poplog3/acompanhando não usa user_title_state

**Arquivo:** `src/app/api/poplog3/acompanhando/route.ts`

Reconstrói manualmente os dados de progresso lendo `user_titles`, `poplog3_episodes`, `poplog3_curadoria_overlay`. Duplica lógica já existente em `user_title_state`.

**Solução:** Reescrever para ler de `user_title_state` + `poplog3_curadoria_overlay`.

### 🟡 ALTA — UserDataContext lê user_titles inteiros

**Arquivo:** `src/context/UserDataContext.tsx`

Faz `SELECT *` em `user_titles` sem filtros. Rerenderiza tudo a cada mutação.
Home deveria consumir endpoints específicos de `user_title_state`.

### 🟡 MÉDIA — Feedback em dois fluxos diferentes

Ao marcar como watched/watchlist, `neutralizeNegativeFeedback()` é chamado em `user-title-service.ts`.
Ao salvar "not_interested", a lógica inversa está em `/api/user/feedback/route.ts`.
Os dois fluxos não se conhecem — risco de estados conflitantes se a ordem das operações mudar.

### 🟡 MÉDIA — Score da curadoria calculado no cliente

`calculatePriorityScore()` roda no browser via `useCuradoriaEngine`. Isso impede cache, dificulta debug e impede uso do score em contextos server-side (ex: emails, notificações futuras).

### 🟢 BAIXA — Encoding de content_id inconsistente

Alguns lugares usam UUID (de `user_title_state.id`), outros usam `"tmdb-{mediaType}-{tmdbId}"` (formato string do `/api/poplog3/acompanhando`). Risco de parsing incorreto ao cruzar dados.

---

## 11. Padrão correto de escrita (referência)

Todo fluxo de escrita deve seguir este padrão:

```typescript
// 1. Escrever na tabela transacional via API route (server-side)
await prisma.userTitles.upsert({ ... });
// ou
await prisma.userEpisodes.create({ ... });

// 2. Atualizar estado materializado (pode ser fire-and-forget)
upsertTitleState({
  userId,
  tmdbId,
  mediaType,
  event: { type: "status_changed", payload: { ... } },
}).catch(console.error);
```

**Nunca escreva em `user_titles` diretamente do cliente no frontend** sem ter um mecanismo de propagação para `user_title_state`.

---

## 12. Componentes e hooks candidatos a universalizar

Estes sistemas já funcionam bem e devem ser a base de expansão para novas páginas:

| Sistema | Arquivo | Use quando |
|---|---|---|
| `readTitleState()` | `src/server/state/user-title-state.ts` | Ler estado de 1 título no servidor |
| `getUserTitleStates()` | `src/server/state/user-title-state.ts` | Ler lista de títulos com filtros |
| `upsertTitleState()` | `src/server/state/user-title-state.ts` | Após qualquer escrita de estado |
| `calculatePriorityScore()` | `src/lib/curadoria-engine.ts` | Scoring de curadoria |
| `selectHeroItems()` | `src/lib/curadoria-engine.ts` | Seleção do hero com diversidade |
| `getHeroCandidates()` | `src/server/continuity/hero-candidates.ts` | Candidatos para hero personalizado |
| `resolveAvailability()` | `src/server/streaming/resolve-availability.ts` | Disponibilidade de streaming |
| Hero route cache | `src/app/api/poplog3/continuity/hero/route.ts` | Referência de LRU in-memory |

---

## 13. Roadmap de consolidação (ordem de prioridade)

1. **Migrar toggles para API routes** — `useWatchedToggle`, `useWatchlistToggle` devem chamar rotas server que invoquem `upsertTitleState()`. Elimina o principal gap de sincronização.

2. **Corrigir WatchlistVivaSection** — substituir escrita direta pelo cliente legado por chamada a API routes com `upsertTitleState()`.

3. **Migrar /api/poplog3/acompanhando para user_title_state** — reescrever a rota para consumir `getUserTitleStates()` + `poplog3_curadoria_overlay`, eliminando joins manuais.

4. **Migrar Home de UserDataContext para endpoints V3** — `ForYouSection` deve consumir `/api/user/for-you` sem depender de `user_titles` inteiros. `WatchlistVivaSection` deve consumir `/api/poplog3/continuity/watchlist-picks`.

5. **Criar provider global V3** — um `TitleStateProvider` client-side que mantém um cache local de `user_title_state` e expõe `invalidate(tmdbId, mediaType)` para propagar mudanças entre componentes na mesma sessão.

6. **Mover scoring para o servidor** — `calculatePriorityScore()` deve rodar na API, não no cliente. Permite cache, debug e reutilização futura.

7. **Consolidar fluxo de feedback** — centralizar `neutralizeNegativeFeedback` e `resolveConflictBeforeNegativeFeedback` em um único ponto chamado por `upsertTitleState()`.
