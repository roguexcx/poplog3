# POPLOG v3 — Local Full Mode

> Modo de desenvolvimento completo sem Supabase nos fluxos principais.
> Não usar em produção ou staging.

## Pré-requisitos

- Docker Desktop instalado e rodando
- Node.js 20+
- Variáveis de ambiente configuradas (ver abaixo)

## 1 — Subir o banco MySQL via Docker

```bash
docker compose up -d
```

O `docker-compose.yml` deve expor MySQL na porta 3306 com:
- usuário: `poplog`
- senha: `poplog_local_password`
- banco: `poplog_v3`

Se o compose não existir, criar manualmente:

```bash
docker run -d \
  --name poplog-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=poplog_v3 \
  -e MYSQL_USER=poplog \
  -e MYSQL_PASSWORD=poplog_local_password \
  -p 3306:3306 \
  mysql:8.0
```

## 2 — Configurar variáveis de ambiente

Copie `.env.local.full.example` para `.env.local`:

```bash
cp .env.local.full.example .env.local
```

O arquivo já vem com todas as flags locais habilitadas. Supabase pode ficar em branco.

## 3 — Aplicar o schema

```bash
npm run db:push
```

Aplica o schema Prisma no banco local sem migrations.

## 4 — Criar o usuário local

```bash
npm run db:seed
```

Cria o usuário `local-user` (ou o valor de `LOCAL_USER_ID`) na tabela `users`.

## 5 — Rodar o smoke de modo completo

```bash
npm run db:smoke:local-full
```

Valida todos os módulos locais em conjunto.

## 6 — Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

## O que funciona em local full mode

| Módulo | Flag | Status |
|---|---|---|
| Auth local | `POPLOG_LOCAL_AUTH_ENABLED` | ✓ Operacional |
| Engine logs | `POPLOG_LOCAL_LOGS_ENABLED` | ✓ Operacional |
| Caches (títulos, temporadas, ratings, external IDs) | `POPLOG_LOCAL_CACHE_ENABLED` | ✓ Operacional |
| Premium API budget | `POPLOG_LOCAL_API_USAGE_ENABLED` | ✓ Operacional |
| Catalog availability | `POPLOG_LOCAL_AVAILABILITY_ENABLED` | ✓ Operacional |
| Biblioteca do usuário | `POPLOG_LOCAL_LIBRARY_ENABLED` | ✓ Operacional |
| User title state | `POPLOG_LOCAL_USER_STATE_ENABLED` | ✓ Operacional |
| Progresso de episódios | `POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED` | ✓ Operacional |
| Ratings pessoais | `POPLOG_LOCAL_USER_RATINGS_ENABLED` | ✓ Operacional |
| Feedback/personalização | `POPLOG_LOCAL_FEEDBACK_ENABLED` | ✓ Operacional |
| Preferências de curadoria | `POPLOG_LOCAL_USER_PREFERENCES_ENABLED` | ✓ Operacional |
| Sinais de curadoria | `POPLOG_LOCAL_CURADORIA_ENABLED` | ✓ Operacional |
| Curadoria state/overlay | `POPLOG_LOCAL_CURADORIA_STATE_ENABLED` | ✓ Operacional |
| GET completo de Acompanhando | `POPLOG_LOCAL_ACOMPANHANDO_ENABLED` | ✓ Operacional |
| Hero Spotlight | `POPLOG_LOCAL_HERO_ENABLED` | ✓ Operacional |
| Continue de onde parou | `POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED` | ✓ Operacional |
| Assistido recentemente | `POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED` | ✓ Operacional |
| Novos episódios | `POPLOG_LOCAL_NEW_EPISODES_ENABLED` | ✓ Operacional |
| Picks da watchlist | `POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED` | ✓ Operacional |
| Radar personalizado | `POPLOG_LOCAL_RADAR_ENABLED` | ✓ Operacional |
| Agenda (availability/library/state) | `POPLOG_LOCAL_AGENDA_ENABLED` | ✓ Operacional |
| Proteção de rotas (middleware) | `POPLOG_LOCAL_AUTH_ENABLED` | ✓ Bypass ativo |

## O que ainda usa Supabase (legado/não migrado)

| Fluxo | Arquivo | Observação |
|---|---|---|
| Streaming preferences | `api/user/streaming-preferences/route.ts` | Tabela `user_streaming_preferences` não migrada |
| Watchlist live | `api/watchlist/live/route.ts` | Usa Supabase diretamente |
| Genre stats | `api/user/genre-stats/route.ts` | Usa `user_titles` via Supabase admin |
| For you | `api/user/for-you/route.ts` | Feedback + Supabase queries |
| Sorteio engine | `server/sorteio/sorteio-engine.ts` | Usa Supabase admin |
| Series episode runtimes | `server/runtime/series-episode-runtimes.ts` | Usa Supabase admin |
| Trending | `api/trending/route.ts` | Usa Supabase admin |
| Fuzzy title search | `server/search/fuzzy-title-search.ts` | Usa Supabase admin |
| Agenda engine | `server/agenda/agenda-engine.ts` | Usa Supabase admin para queries de título |
| Upcoming episodes | `api/poplog3/continuity/upcoming-episodes/route.ts` | Ainda não migrado |
| UI/hooks client-side | `useAuth`, `LoginDrawer`, `Sidebar` | Fora do escopo |
| Context de dados client | `UserDataContext`, `WatchlistVivaSection` | Fora do escopo |
| Debug/admin endpoints | `api/debug/*`, `api/admin/*` | Baixa prioridade |

## Dependências Supabase que permanecem como fallback

Os clientes Supabase ainda são importados em módulos migrados, mas só são usados quando:
- A flag correspondente está desligada (fallback intencional)
- O módulo ainda não foi migrado

A tabela `docs/LOCAL_FULL_MODE_AUDIT.md` tem o mapa completo.

## Comportamento do middleware em local full mode

Com `POPLOG_LOCAL_AUTH_ENABLED=true`, o middleware (`src/middleware.ts`) libera acesso a todas as rotas protegidas sem verificar Supabase Auth. As rotas `/library`, `/acompanhando`, `/profile`, `/settings`, `/sorteio`, `/admin` e `/debug` ficam acessíveis diretamente.

Com `POPLOG_LOCAL_AUTH_ENABLED=false`, o middleware delega ao proxy Supabase — se Supabase não estiver configurado, o usuário será redirecionado para `/`.

## Limitações conhecidas

- `rating_aggregates` não reimplementado no MySQL local (ratings pessoais funcionam, community ratings não)
- Campos nullificados em availability local: `deep_link`, `quality`, `provider_logo_path`, `tmdb_provider_id`
- GET de Acompanhando local: `watch_progress_minutes`, `sessions_last_*`, `is_marathon`, `priority_score` são placeholders
- Hero local: `isPreferred` sempre false (sem TMDB provider_id no schema)
- `upcoming-episodes` ainda usa Supabase (não migrado)
- Sorteio, trending, genre-stats e for-you ainda usam Supabase
