# POPLOG v3 — Modo de Desenvolvimento Local

Modo padrão de desenvolvimento. Usa MySQL local via Docker + Auth.js com usuário fixo de dev.
Não usar em produção ou staging.

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

O arquivo já vem com todas as flags locais habilitadas.

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

## 5 — Rodar os smokes

```bash
npm run db:smoke:local-full
```

Valida todos os módulos locais em conjunto. Todos os 14 smokes devem passar.

## 6 — Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

## Módulos disponíveis em modo local

| Módulo | Flag | Status |
|---|---|---|
| Auth local | `POPLOG_LOCAL_AUTH_ENABLED` | Operacional |
| Engine logs | `POPLOG_LOCAL_LOGS_ENABLED` | Operacional |
| Caches (títulos, temporadas, ratings, external IDs) | `POPLOG_LOCAL_CACHE_ENABLED` | Operacional |
| Premium API budget | `POPLOG_LOCAL_API_USAGE_ENABLED` | Operacional |
| Catalog availability | `POPLOG_LOCAL_AVAILABILITY_ENABLED` | Operacional |
| Biblioteca do usuário | `POPLOG_LOCAL_LIBRARY_ENABLED` | Operacional |
| User title state | `POPLOG_LOCAL_USER_STATE_ENABLED` | Operacional |
| Progresso de episódios | `POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED` | Operacional |
| Ratings pessoais | `POPLOG_LOCAL_USER_RATINGS_ENABLED` | Operacional |
| Feedback/personalização | `POPLOG_LOCAL_FEEDBACK_ENABLED` | Operacional |
| Preferências de curadoria | `POPLOG_LOCAL_USER_PREFERENCES_ENABLED` | Operacional |
| Sinais de curadoria | `POPLOG_LOCAL_CURADORIA_ENABLED` | Operacional |
| Curadoria state/overlay | `POPLOG_LOCAL_CURADORIA_STATE_ENABLED` | Operacional |
| GET completo de Acompanhando | `POPLOG_LOCAL_ACOMPANHANDO_ENABLED` | Operacional |
| Hero Spotlight | `POPLOG_LOCAL_HERO_ENABLED` | Operacional |
| Continue de onde parou | `POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED` | Operacional |
| Assistido recentemente | `POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED` | Operacional |
| Novos episódios | `POPLOG_LOCAL_NEW_EPISODES_ENABLED` | Operacional |
| Picks da watchlist | `POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED` | Operacional |
| Radar personalizado | `POPLOG_LOCAL_RADAR_ENABLED` | Operacional |
| Agenda (availability/library/state) | `POPLOG_LOCAL_AGENDA_ENABLED` | Operacional |
| Proteção de rotas (middleware) | `POPLOG_LOCAL_AUTH_ENABLED` | Bypass ativo |
| Streaming preferences | `POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED` | Operacional |

## Comportamento do middleware em modo local

Com `POPLOG_LOCAL_AUTH_ENABLED=true`, o middleware (`src/middleware.ts`) libera acesso a todas as rotas protegidas sem passar pelo Google OAuth. As rotas `/library`, `/acompanhando`, `/profile`, `/settings`, `/sorteio`, `/admin` e `/debug` ficam acessíveis diretamente com o usuário fixo de dev.

Com `POPLOG_LOCAL_AUTH_ENABLED=false` (ou ausente), o middleware usa o fluxo normal do Auth.js/NextAuth com Google OAuth. Nesse caso, é necessário ter `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` e `AUTH_SECRET` configurados.

## Limitações conhecidas

- `rating_aggregates`: ratings pessoais funcionam; community ratings não são recomputados automaticamente em dev.
- Campos nullificados em availability local: `deep_link`, `quality`, `provider_logo_path`, `tmdb_provider_id`.
- GET de Acompanhando local: `watch_progress_minutes`, `sessions_last_*`, `is_marathon`, `priority_score` são placeholders.
- Hero local: `isPreferred` sempre false (sem TMDB provider_id no schema local).
