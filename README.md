# POPLOG 3.0 CLEAN

Base limpa para reconstrução controlada do POPLOG.

Esta branch mantém a identidade visual e a estrutura mínima do frontend, mas remove a lógica funcional antiga: APIs internas, integrações externas, autenticação, sessões, cache, pipelines, heurísticas, radar, providers e migrations.

## Como rodar

```bash
docker compose up -d mysql redis
npm run dev
```

Abra `http://localhost:3000`.

## Redis local

O Redis local roda via Docker Compose em `redis://127.0.0.1:6379`.

```bash
docker compose up -d redis
npm run cache:smoke:redis
```

O smoke valida PING, escrita JSON, leitura JSON e limpeza por namespace.

## Cron de workers

A fila de refresh pode rodar de duas formas:

```bash
npm run workers:refresh
npm run workers:cron:smoke
```

Em produção, configure um scheduler externo para chamar `POST /api/cron/refresh-workers` com `Authorization: Bearer $POPLOG_CRON_SECRET`. O workflow `.github/workflows/poplog-worker-cron.yml` já faz essa chamada a cada 5 minutos quando os secrets `POPLOG_CRON_URL` e `POPLOG_CRON_SECRET` estiverem configurados.

## O que ficou

- Next.js App Router
- React
- Tailwind CSS
- `lucide-react`
- Layout base
- Sidebar desktop/mobile
- Estilos globais
- Páginas neutras para as rotas principais

## O que saiu

- Rotas em `src/app/api`
- Integrações de catálogo e streaming
- Autenticação e middleware de sessão legados
- Hooks e providers de usuário
- Cache e sincronização
- Regras de recomendação, confiança e contexto
- Migrations e scripts de banco antigos

Use o histórico do git como referência técnica do sistema anterior quando precisar consultar a implementação antiga.
