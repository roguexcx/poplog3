# Cobertura de Regressão Local POPLOG V2

Este documento registra a regressão automatizada da versão local atual. O objetivo é parar de depender de smokes soltos e ter um comando de referência para validar a base antes de novas camadas.

## Comando principal

```bash
npm run regression:local
```

Por padrão, o comando é não destrutivo:

- roda o reset de catálogo em modo dry-run;
- garante seed mínimo do Sorteio;
- valida banco/cache/workers/providers/admin/i18n/SEO;
- exige servidor local ativo para os testes HTTP, SEO e performance.

Para rodar sem servidor local:

```bash
npm run regression:local -- --skip-http
```

Para validar reset aplicado em ambiente descartável:

```bash
npm run regression:local -- --destructive-reset
```

## Critérios cobertos

- Home e Trending: `smoke:local-http`, `perf:local`.
- Busca: `smoke:local-http`, cache por `language + region`.
- Página de título filme/série: `smoke:local-http`, `smoke:seo:title`, `smoke:cold-series`.
- Providers por categoria: `smoke:providers:commercial-fixtures`, `smoke:provider-normalization`, `db:smoke:availability`, `smoke:availability-stale`.
- Biblioteca: `db:smoke:library-state`, `smoke:library-identity`, `smoke:local-http`.
- Para Você: `smoke:local-http`, `perf:local`.
- Sorteio com seed mínimo: `sorteio:seed-minimum`, `db:smoke:sorteio-minimum-pool`, `db:smoke:sorteio-local-draw`.
- Admin e permissões: `db:smoke:admin-user-access`, `smoke:local-http`.
- i18n: `audit:i18n -- --fail-on-hardcoded`.
- SEO: `smoke:seo:title`.
- Redirects 308: `smoke:seo:title`, `smoke:local-http`.
- Redis real: `cache:smoke:redis`.
- Workers/cron: `db:smoke:refresh-queue`, `workers:cron:smoke`.
- Reset + seed mínimo: `db:reset:catalog:dry` ou `db:reset:catalog` em ambiente descartável, seguido de `sorteio:seed-minimum`.
- Primeira visita fria de série: `smoke:cold-series`.
- Availability stale: `smoke:availability-stale`.
- Cache por idioma/região: `smoke:local-http`.
- Assets locais e S3-compatible opcional: `smoke:assets-local` e `smoke:assets-s3-local` quando o bucket MinIO/local ou credenciais S3 estiverem ativos.
- Posições de anúncios desligadas: `smoke:ads-placement`.
- Radar V2: smoke de `/radar` e `/api/radar`, verificando página sem `legacy=1` e payload V2 direto.

## Resultado esperado

A suíte deve terminar com todos os passos `ok`. Falha em qualquer etapa interrompe a regressão para deixar o primeiro problema claro.

## Pré-requisitos locais

- Banco local disponível.
- Redis local disponível quando `REDIS_URL` estiver configurado.
- Servidor local rodando para testes HTTP:

```bash
npm run dev
```

- Auth local pode ser usado para smoke:

```bash
POPLOG_LOCAL_AUTH_ENABLED=true
LOCAL_USER_ID=local-user
```

## Escopo fora desta regressão

- Auditoria visual multi-browser/mobile completa: usar `npm run audit:visual`.
- Safari/iPhone/Android reais: validar em aparelho real ou serviço externo antes de produção.
- Auditoria visual pós-Radar: executar quando a revisão multi-browser/mobile for retomada.
