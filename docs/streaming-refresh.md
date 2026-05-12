# Streaming Refresh Operacional

Este documento descreve como operar o refresh controlado de disponibilidade do POPLOG sem ativar sync massivo, cron ou APIs premium.

## 1. Variaveis de ambiente

Configure no `.env.local`:

```env
ADMIN_SECRET=um-segredo-longo-local
STREAMING_SYNC_ENABLED=false

TMDB_DAILY_BUDGET=1000
WATCHMODE_MONTHLY_BUDGET=2500
MOVIEOFTHENIGHT_MONTHLY_BUDGET=500

WATCHMODE_ENABLED=false
MOVIEOFTHENIGHT_ENABLED=false
STREAMING_DEBUG_LOGS=false
```

`ADMIN_SECRET` protege rotas mutaveis. `STREAMING_SYNC_ENABLED=false` deixa refresh real bloqueado, mas permite simular.

## 2. Aplicar migrations

Com Supabase CLI instalada e projeto linkado:

```bash
supabase migration list
supabase db push
```

Sem CLI, aplique manualmente no SQL Editor do painel Supabase, nesta ordem:

1. `supabase/migrations/20260512014317_streaming_cache_foundation.sql`
2. `supabase/migrations/20260512014334_streaming_sync_operational_metadata.sql`
3. `supabase/migrations/20260512015125_streaming_refresh_operational_indexes.sql`

Esses nomes tambem batem com o historico remoto do projeto Supabase conectado.

As migrations usam `create table if not exists`, `create index if not exists` e `add column if not exists` onde aplicavel.

## 3. Testar status

```bash
curl -H "x-admin-secret: um-segredo-longo-local" \
  http://localhost:3000/api/admin/streaming/status
```

O status mostra linhas de availability, providers, cache valido, cache expirado, cache sem TTL, media de confidence, inferred, available_abroad, ultimos logs, flags e budgets. Nenhuma chave e retornada.

## 4. Dry run quick

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"quick","country":"BR","dryRun":true}'
```

Esse modo lista poucos candidatos criticos e nao chama TMDB.

## 5. Dry run normal

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"normal","country":"BR","dryRun":true}'
```

O retorno inclui prioridade, motivos, status atual, confidence atual, `cacheValidUntil`, se chamaria TMDB, custo estimado e perfil usado.

## 6. Refresh single

Para simular:

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"single","tmdbId":550,"mediaType":"movie","country":"BR","force":true,"dryRun":true}'
```

Para executar de verdade:

```env
STREAMING_SYNC_ENABLED=true
```

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"single","tmdbId":550,"mediaType":"movie","country":"BR","force":true}'
```

## 7. Refresh normal

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"normal","country":"BR","limit":10}'
```

`deep` existe para manutencao controlada e deve ser chamado explicitamente:

```bash
curl -X POST http://localhost:3000/api/admin/streaming/refresh \
  -H "content-type: application/json" \
  -H "x-admin-secret: um-segredo-longo-local" \
  -d '{"profile":"deep","country":"BR","limit":25}'
```

O limite absoluto e 50 itens por execucao.

## 8. Evitar gasto excessivo

Use sempre `dryRun` antes de refresh real. O guard de budget estima uma chamada TMDB por titulo processado. Watchmode e MovieOfTheNight ja tem budgets configurados, mas continuam desligados e nao sao usados nesta etapa.

Se `api_sync_logs` estiver indisponivel, o budget nao bloqueia o ambiente local; ele retorna uso desconhecido e permite o teste para nao travar desenvolvimento.

## 9. Cron futuro

Nao ha cron ativo nesta etapa.

Exemplos futuros, ainda nao aplicados:

```json
{
  "crons": [
    {
      "path": "/api/admin/streaming/refresh",
      "schedule": "0 9 * * *"
    }
  ]
}
```

Alternativas futuras:

- Vercel Cron chamando `profile=quick`.
- Supabase Scheduled Function chamando a rota admin.
- GitHub Actions com `curl` e secret.
- Execucao manual por operador.

## 10. Troubleshooting

- `401`: verifique `ADMIN_SECRET` e header `x-admin-secret`.
- `409` com `STREAMING_SYNC_ENABLED=false`: o bloqueio esta correto; use `dryRun` ou habilite a flag localmente.
- Status sem dados de banco: verifique `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e migrations aplicadas.
- Budget bloqueou: reduza `limit`, use `quick`, ou revise `TMDB_DAILY_BUDGET`.
- Watchmode/MovieOfTheNight devem permanecer `false` ate uma etapa especifica de integracao premium.

Abra nova etapa quando o cache ja estiver validado e for hora de conectar a disponibilidade persistida as superficies do site.
