# POPLOG v3

POPLOG é um indexador/curador de catálogo de filmes e séries (não hospeda nem
distribui mídia — ver `docs/legal/DISCLAIMER.md`). Stack: **Next.js (App Router)
+ TypeScript**, **Prisma sobre MySQL**, **NextAuth**, **Zustand**, **Tailwind**.

Princípio operacional: **POPLOG-first / IMDb-first** — as APIs externas
identificam e renovam dados; o app lê preferencialmente do banco/cache local.

## Documentação

A fonte de verdade do sistema vive em `docs/`:

- **`docs/POPLOG_SYSTEM_OVERVIEW.md`** — visão geral completa (fonte de verdade).
- `docs/architecture/POPLOG_GLOBAL_UNIFICATION_PLAN.md` — pendências e migrações.
- `docs/DOCS_AUDIT_AND_CLEANUP.md` — auditoria/organização da documentação.
- `docs/modules/` · `docs/operations/` · `docs/production/` · `docs/legal/` ·
  `docs/monetization/` · `docs/archive/` (histórico).

## Como rodar (local)

```bash
docker compose up -d mysql redis
npm run db:push        # aplica o schema
npm run db:seed        # cria o usuário local
npm run dev
```

Abra `http://localhost:3000`.

## Redis local

Roda via Docker Compose em `redis://127.0.0.1:6379`.

```bash
docker compose up -d redis
npm run cache:smoke:redis   # valida PING, SET/GET JSON e DEL por namespace
```

## Cron de workers

A fila de refresh (`PoplogRefreshQueue`) pode rodar de duas formas:

```bash
npm run workers:refresh        # worker contínuo
npm run workers:cron:smoke     # valida o endpoint protegido de cron
```

Em produção, um scheduler externo chama `POST /api/cron/refresh-workers` com
`Authorization: Bearer $POPLOG_CRON_SECRET`. O workflow
`.github/workflows/poplog-worker-cron.yml` faz isso a cada 5 min quando
`POPLOG_CRON_URL` e `POPLOG_CRON_SECRET` estão configurados.

## Validação

```bash
npm run typecheck
npm run lint
npm run regression:local -- --skip-http
npm run audit:i18n -- --fail-on-hardcoded
npm run smoke:ads-placement
```
