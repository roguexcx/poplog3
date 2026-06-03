# POPLOG v3 Local DB Migration Map

Este mapa acompanha a troca gradual dos serviços Supabase por adapters Prisma/MySQL.
O codigo atual ainda preserva os serviços antigos. A partir da Fase 7A, os modulos de baixo risco abaixo podem escolher o adapter local quando as flags `POPLOG_LOCAL_DB_ENABLED`, `POPLOG_LOCAL_LOGS_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED` estiverem ligadas.

| Modulo | Servico Supabase atual | Adapter Prisma local | Repository usado | Status | Observacoes de risco |
| --- | --- | --- | --- | --- | --- |
| Engine logger persistence | `src/server/engine-logger/persistence.ts` | `src/server/local-services/engine-logger-local.service.ts` | `engine-logs.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_LOGS_ENABLED`. O RPC `engine_api_call_log_stats` foi substituido por agregacao em memoria sobre a janela de 24h. |
| API usage daily | usos diretos futuros / tabela `api_usage_daily` | `src/server/local-services/api-usage-local.service.ts` | `api-usage.repository.ts` | Criado e testado | Contrato local retorna `RepositoryResult`; consumidores atuais podem precisar de adapter fino ao migrar. |
| Premium API usage | `src/server/rate-limits/premium-api-budget.ts` | `src/server/local-services/api-usage-local.service.ts` | `premium-api-usage.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_API_USAGE_ENABLED`. Status preservados: `reserved`, `success`, `failed`, `empty`, `blocked`. `recordBlockedBudget` recebe `periodKeys` para preencher `periodDay`/`periodMonth` no Prisma. |
| ICS agenda cache | `src/app/api/ics/agenda/route.ts`, `background-refresh/route.ts` | `src/server/local-services/ics-agenda-cache-local.service.ts` | `ics-agenda-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. Adapter valida `cacheVersion`; memoria em processo continua responsabilidade da rota. |
| Continuity section cache | `src/server/continuity/continuity-section-cache.ts` | `src/server/local-services/continuity-section-cache-local.service.ts` | `continuity-section-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. `invalidateContinuitySectionCache` preserva fire-and-forget. |
| Title cache | `src/server/cache/title-cache.ts` | `src/server/local-services/title-cache-local.service.ts` | `title-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. Datas saem como `YYYY-MM-DD`; payload TMDB tenta normalizacao por `normalizeTmdbTitleDetails`, como no servico atual. |
| Season cache | `src/server/cache/season-cache.ts` | `src/server/local-services/season-cache-local.service.ts` | `season-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. Contrato de leitura retorna snake_case; escrita lança erro se repository retorna `false`. |
| Ratings cache | `src/server/cache/ratings-cache.ts` | `src/server/local-services/ratings-cache-local.service.ts` | `ratings-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. Campos ausentes continuam como `undefined` no retorno, espelhando o servico atual. |
| External IDs cache | `src/server/cache/external-ids-cache.ts` | `src/server/local-services/external-ids-cache-local.service.ts` | `external-ids-cache.repository.ts` | Plugado por flag | Controlado por `POPLOG_LOCAL_DB_ENABLED` ou `POPLOG_LOCAL_CACHE_ENABLED`. Upsert preserva IDs existentes quando novos valores chegam nulos, via repository. |
| Catalog availability cache | `src/server/cache/availability-cache.ts` / caches de availability | `src/server/local-services/catalog-availability-local.service.ts` | `catalog-availability.repository.ts` | Criado e testado | Este adapter cobre `catalog_availability`. A tabela legado `poplog3_title_availability` ainda precisara de decisao antes da troca completa. |
| Biblioteca do usuario | `src/server/library/library-service.ts` | `src/server/local-services/library-local.service.ts` | `library.repository.ts`, `title-cache.repository.ts`, `user-title-state.repository.ts`, `user-events.repository.ts` | Criado e testado | Preserva CRUD principal e formato snake_case. Nao dispara refresh externo de availability/TMDB nesta fase. |
| User title state | `src/server/state/user-title-state.ts` | `src/server/local-services/user-title-state-local.service.ts` | `user-title-state.repository.ts`, `user-events.repository.ts` | Criado e testado | Materializacao local cobre progresso/status/flags principais. Backfills de runtime, franquia e refresh de catalogo ficam para fase de plug controlado. |
| Progresso de episodios | `src/server/episodes/episode-progress-service.ts` | `src/server/local-services/episode-progress-local.service.ts` | `episode-progress.repository.ts`, `library.repository.ts`, `user-title-state.repository.ts`, `user-events.repository.ts` | Criado e testado | Toggle e clear sincronizam estado local. Funcoes avancadas como `markEpisodesUntil` e `markAllAiredEpisodes` ainda nao foram expostas no adapter. |
| Ratings pessoais | `src/server/ratings/user-rating-service.ts` | `src/server/local-services/user-ratings-local.service.ts` | `user-ratings.repository.ts` | Criado e testado | CRUD pessoal preservado. Recalculo de `rating_aggregates` ainda nao foi reimplementado em MySQL local. |
| Preferencias de usuario | `user_curadoria_preferences` em rotas/servicos atuais | `src/server/local-services/user-preferences-local.service.ts` | `user-preferences.repository.ts` | Criado e testado | Contrato local retorna snake_case para facilitar compatibilidade com rotas atuais. |
| Feedback/personalizacao | `src/server/personalization/title-feedback-engine.ts`, `src/lib/personalization/feedback.ts`, `src/app/api/user/feedback/*` | `src/server/local-services/feedback-local.service.ts` | `user-feedback.repository.ts`, `library.repository.ts`, `user-title-state.repository.ts`, `user-events.repository.ts` | Criado e testado | Persiste feedback e sincroniza flags editoriais principais. Nao substitui toda a engine editorial nem conflitos de feedback negativo antes da troca real. |
| Eventos de usuario | `user_events` via `state/user-title-state.ts`, feedback e sorteio | `src/server/local-services/user-title-state-local.service.ts`, `curadoria-local.service.ts`, `feedback-local.service.ts` | `user-events.repository.ts` | Criado e testado | Eventos sao fire-and-forget onde o servico antigo tambem nao bloqueia fluxo. |
| Sinais de curadoria | `src/app/api/poplog3/acompanhando/route.ts` | `src/server/local-services/curadoria-local.service.ts` | `curadoria-signals.repository.ts`, `user-events.repository.ts` | Criado e testado | Cobre logs de sinais. Overlay `user_curadoria_state` ainda nao foi modelado no Prisma e segue fora da ponte local. |

## Fora da Fase 7B

- Troca de imports em endpoints, hooks ou componentes.
- Remocao de Supabase ou dependencias Supabase.
- Plug de catalog availability, porque o adapter cobre `catalog_availability` e o legado ainda usa estruturas de availability com semantica diferente.
- Plug de biblioteca, user title state, progresso, feedback e curadoria em endpoints reais.

## Riscos conhecidos pos-Fase 7B

- `completePremiumApiBudget` usa a flag no momento da conclusao, nao no da reserva. Se a flag for alternada entre reserva e conclusao de uma mesma chamada, o ID pode ser enviado para o backend errado. Nao alternar flags durante requests ativos.
- O teste de bloqueio por budget esgotado nao foi validado no smoke automatico por exigir insercao de centenas de registros. A logica de bloqueio nao foi alterada — apenas o backend de persistencia foi trocado.

## Diferencas conhecidas antes de plugar endpoints

- Availability/TMDB sync colateral ainda fica nos servicos Supabase atuais.
- `rating_aggregates` ainda precisa de repository/adapter proprio se o fluxo de rating for migrado.
- `user_curadoria_state` aparece no fluxo de Acompanhando, mas ainda nao existe na camada Prisma local.
- A engine editorial completa deve continuar no servico atual ate a troca ser feita por flag e com comparacao de payload.
