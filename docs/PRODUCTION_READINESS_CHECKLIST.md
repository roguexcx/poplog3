# Checklist de Produção Futura

Esta etapa ainda não é deploy. É o pacote de preparação para migrar com segurança depois.

## Antes do deploy

- Rodar `npm run regression:local`.
- Rodar `npm run audit:visual`.
- Revisar screenshots em `artifacts/visual-audit/`.
- Confirmar `.env.production.example` preenchido em ambiente seguro.
- Confirmar backup do banco local.
- Confirmar estratégia de restore testada.
- Confirmar Redis remoto ou fallback banco-first.
- Confirmar storage remoto/CDN ou manter storage local.
- Confirmar cron externo chamando `/api/cron/refresh-workers`.
- Confirmar `POPLOG_WORKER_MAX_CONCURRENCY` conservador.
- Confirmar logs de erro, cron e workers acessíveis.

## Banco

- MySQL gerenciado deve usar connection string com limites:

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DB?connection_limit=5&pool_timeout=10&connect_timeout=10"
```

- Workers devem ficar abaixo da capacidade do banco.
- Queries lentas devem ser monitoradas com `PRISMA_SLOW_QUERY_MS`.

## Redis

- Se Redis falhar, o sistema deve manter fallback por banco/cache persistente.
- `cache:smoke:redis` deve ser rodado quando `REDIS_URL` for definido.

## Workers e cron

- Scheduler externo chama `POST /api/cron/refresh-workers`.
- Header: `Authorization: Bearer $POPLOG_CRON_SECRET`.
- Admin deve mostrar heartbeat recente.
- Jobs travados/atrasados devem gerar alerta visual no Admin.

## Storage/CDN

- Validar `smoke:assets-local` com backend escolhido.
- Validar imagens em cards, página de título, Admin e OG image.
- Documentar rollback para local.

## Emergência

- Redis falhou: limpar `REDIS_URL` e usar fallback.
- CDN falhou: voltar `POPLOG_ASSET_PUBLIC_BASE_URL=/storage`.
- Worker travou: reduzir `POPLOG_WORKER_MAX_CONCURRENCY=1` e reprocessar pelo Admin.
- Providers instáveis: usar cache stale e reidratar manualmente títulos críticos.
- Banco saturado: pausar cron externo, reduzir concorrência, revisar queries lentas.

## Hostinger futura

O plano Business deve ser tratado como limite de desenho: 2 CPU, 3 GB RAM, MySQL gerenciado, 50 GB NVMe, CDN, WAF, backups e até 5 apps Node. A aplicação deve priorizar banco-first, cache, filas com baixa concorrência, imagens otimizadas e renovação gradual de dados.
