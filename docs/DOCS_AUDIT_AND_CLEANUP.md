# POPLOG — Auditoria e Limpeza da Documentação

> Auditoria executada em 2026-06-26 (branch `feature/sistema-novo`).
> Objetivo: transformar `/docs` de um acúmulo de planos soltos em uma estrutura
> única, com fonte de verdade clara e histórico arquivado.

> **Atualização 2026-06-26.** O `docs/archive/` foi posteriormente **removido**
> (os 11 documentos históricos, incl. 4 `.docx`, permanecem no histórico do git).
> As decisões "Arquivar → archive/" na tabela abaixo são o registro do que foi
> feito à época. Os deep-dives em `modules/` (APIS, RECOMMENDATIONS, TRENDING)
> foram atualizados (correções de rota/banco). Fonte canônica:
> `POPLOG_SYSTEM_OVERVIEW.md` + `POPLOG_SYSTEM_DIAGNOSTIC.md`.

## 1. Resumo executivo

Antes desta rodada a documentação estava espalhada entre a raiz do repositório e
`/docs`, misturando documento mestre, planos já executados, relatórios históricos,
prompts de IA e arquivos `.docx` binários. Havia contradições reais com o código
(ver §4) e cinco arquivos `.md`/`.docx` soltos na raiz.

Resultado desta rodada:

- nova estrutura `docs/{modules,architecture,operations,production,legal,monetization,archive}`;
- fonte de verdade única: `docs/POPLOG_SYSTEM_OVERVIEW.md` (novo);
- plano de unificação global: `docs/architecture/POPLOG_GLOBAL_UNIFICATION_PLAN.md` (novo);
- 11 documentos superados movidos para `docs/archive/`;
- raiz do repositório limpa (sobra apenas `README.md`);
- contradições documentação-vs-código catalogadas e endereçadas no plano de unificação.

## 2. Nova estrutura de `/docs`

```txt
docs/
  POPLOG_SYSTEM_OVERVIEW.md          # FONTE DE VERDADE (novo)
  DOCS_AUDIT_AND_CLEANUP.md          # este documento (novo)
  architecture/
    POPLOG_GLOBAL_UNIFICATION_PLAN.md  # plano de unificação (novo)
    CURATION_INDEXING_STRUCTURE.md     # estrutura-alvo (mantido)
  modules/
    TRENDING.md            # ex INVESTIGACAO-TRENDING-EM-ALTA.md
    RADAR.md               # ex RADAR_CURRENT_GUIDE.md
    LISTS.md               # ex PLANO-LISTAS-PERSONALIZADAS.md
    RECOMMENDATIONS.md     # ex Recomendacoes-Mapeamento-Tecnico.md (raiz)
    APIS.md                # ex MAPEAMENTO-APIS-POPLOG.md (raiz)
  operations/
    LOCAL_FULL_MODE.md
    LOCAL_REGRESSION_COVERAGE.md
    BACKUP_RESTORE.md
    VISUAL_AUDIT_MATRIX.md
  production/
    PRODUCTION_READINESS_CHECKLIST.md
    REMOTE_STORAGE_CDN_PLAN.md
  monetization/
    ADS_PLACEMENT_PLAN.md
  legal/
    DISCLAIMER.md
  archive/                 # histórico, não é fonte de verdade
    POPLOG_V2_SYSTEM_OVERVIEW.md
    ARCHITECTURE-V3-MAY2026.md
    POPLOG_FIRST_MIGRATION_STATUS.md
    RADAR_STATUS_REPORT.md
    RADAR_SYSTEM_REPORT.md
    RADAR_V2_UI_MIGRATION_PLAN.md
    prompt-agenda-rework.md
    *.docx (4 relatórios binários históricos)
```

## 3. Inventário e decisão por documento

Legenda de decisão: **Fonte** = vira/é fonte de verdade · **Manter** = continua válido ·
**Mover** = realocado · **Arquivar** = histórico · **Reescrever** = substituído por novo.

| Documento (origem) | Significado | Estado vs código | Decisão | Destino |
|---|---|---|---|---|
| `docs/POPLOG_V2_SYSTEM_OVERVIEW.md` | Visão consolidada (a mais atual, editada 26/06) | Atual, porém nomeada "V2" num repo "v3" | Reescrever → base do novo mestre | `archive/` |
| `ARCHITECTURE.md` (raiz) | Arquitetura "V3" de Mai/2026 | **Desatualizado**: descreve identidade TMDB-central e Home com TMDB trending (hoje é Trakt/IMDb-first) | Arquivar | `archive/ARCHITECTURE-V3-MAY2026.md` |
| `MAPEAMENTO-APIS-POPLOG.md` (raiz) | Mapa de APIs externas/internas (24/06) | Atual, mas diz "PostgreSQL" (o banco é **MySQL**) e lista TVDB/OMDb como clients ativos (clients já removidos) | Mover + corrigir no mestre | `modules/APIS.md` |
| `Recomendacoes-Mapeamento-Tecnico.md` (raiz) | Pipeline de recomendações (RRF, Para Você) | Majoritariamente atual | Mover | `modules/RECOMMENDATIONS.md` |
| `POPLOG_FIRST_MIGRATION_STATUS.md` (raiz) | Status da migração IMDb-first | Histórico (migração concluída) | Arquivar | `archive/` |
| `RADAR_STATUS_REPORT.md` (raiz) | Relatório do Radar antigo | **Desatualizado**: descreve `RadarClient.tsx` (2816 linhas) que **não existe mais** (hoje `RadarV2Client.tsx`) | Arquivar | `archive/` |
| `RADAR_SYSTEM_REPORT.md` (raiz) | Regras/pesos do Radar antigo | Desatualizado (mesma razão) | Arquivar | `archive/` |
| `docs/INVESTIGACAO-TRENDING-EM-ALTA.md` | Investigação do Trending V2 (26/06) | Atual e preciso | Mover | `modules/TRENDING.md` |
| `docs/RADAR_CURRENT_GUIDE.md` | Guia do Radar V2 atual | Atual | Mover | `modules/RADAR.md` |
| `docs/RADAR_V2_UI_MIGRATION_PLAN.md` | Plano de migração da UI do Radar | Concluído (UI já em V2) | Arquivar | `archive/` |
| `docs/PLANO-LISTAS-PERSONALIZADAS.md` | Plano de listas personalizadas | Implementado | Mover | `modules/LISTS.md` |
| `docs/prompt-agenda-rework.md` | Prompt de rework da Agenda | **Moot**: a Agenda virou redirect para `/radar` (módulo morto) | Arquivar | `archive/` |
| `docs/architecture/CURATION_INDEXING_STRUCTURE.md` | Estrutura-alvo de diretórios | Atual e útil | Manter | (no lugar) |
| `docs/legal/DISCLAIMER.md` | Aviso legal PT/EN | Atual | Manter | (no lugar) |
| `docs/BACKUP_RESTORE.md` | Backup/restore MySQL | Atual | Mover | `operations/` |
| `docs/LOCAL_FULL_MODE.md` | Modo de dev local | Atual | Mover | `operations/` |
| `docs/LOCAL_REGRESSION_COVERAGE.md` | Cobertura de regressão local | Atual | Mover | `operations/` |
| `docs/VISUAL_AUDIT_MATRIX.md` | Matriz de auditoria visual | Atual | Mover | `operations/` |
| `docs/PRODUCTION_READINESS_CHECKLIST.md` | Checklist de produção | Atual | Mover | `production/` |
| `docs/REMOTE_STORAGE_CDN_PLAN.md` | Plano de storage/CDN | Atual | Mover | `production/` |
| `docs/ADS_PLACEMENT_PLAN.md` | Posições de anúncios | Atual | Mover | `monetization/` |
| `*.docx` (4 na raiz) | Relatórios binários (02–21/06): Auditoria-Disponibilidade, Mapeamento-Técnico, Radar-Auditoria, agenda-radar | Histórico, binário, não versionável como texto | Arquivar | `archive/` |

## 4. Contradições documentação × código encontradas

Estas divergências motivaram a reorganização e estão tratadas no plano de unificação:

1. **Banco de dados**: `MAPEAMENTO-APIS-POPLOG.md` afirma "PostgreSQL via Prisma".
   O `prisma/schema.prisma` declara `provider = "mysql"` e `docker-compose.yml`
   sobe MySQL. → O banco real é **MySQL**. Corrigido no mestre.
2. **Identidade**: `ARCHITECTURE.md` (raiz) trata `tmdb_id` como identidade central
   (`user_title_state` keyed por tmdb_id, Home com TMDB trending). O estado real é
   **IMDb-first**, com `tmdbId` como alias sintético e Trakt Index como fonte de
   trending. → `ARCHITECTURE.md` arquivado como histórico.
3. **Radar**: `RADAR_STATUS_REPORT.md`/`RADAR_SYSTEM_REPORT.md` descrevem
   `src/app/radar/RadarClient.tsx` (2816 linhas). Esse arquivo **não existe** —
   foi substituído por `RadarV2Client.tsx`. → Arquivados.
4. **Clients externos**: `MAPEAMENTO-APIS-POPLOG.md` lista TheTVDB e OMDb como
   clients ativos. Os arquivos `src/server/api-clients/{omdb,tvdb}/client.ts` foram
   removidos (diretórios ficaram vazios, agora deletados). A informação útil foi
   preservada no mestre; o doc movido para `modules/APIS.md` com ressalva.
5. **Atribuição legal exibida**: `src/attribution/api-sources.ts` listava
   TMDB/Watchmode/Movie of the Night/Banco de Séries como fontes ativas, e esse
   registro é **renderizado ao usuário** no `AttributionModal`. → Corrigido nesta
   rodada (ver `POPLOG_GLOBAL_UNIFICATION_PLAN.md` §"Mudanças implementadas").
6. **Agenda**: `prompt-agenda-rework.md` planeja a engine da Agenda, mas
   `src/app/agenda/page.tsx` é um `redirect("/radar")` e o módulo `features/agenda`
   + `server/agenda` + `/api/poplog3/agenda*` não têm referências de código vivo. →
   Prompt arquivado; remoção do módulo morto documentada no plano.

## 5. Limpeza de código aplicada nesta rodada (resumo)

Detalhes e justificativa em `POPLOG_GLOBAL_UNIFICATION_PLAN.md`. Tudo validado com
`npm run typecheck` (exit 0).

- Removidos: `src/server/index.ts` (barrel sem nenhum import) e
  `src/server/strategies/api-priority.ts` (config morta e desatualizada, só
  referenciada pelo barrel).
- Removidos 10 diretórios órfãos vazios (clients/rotas extintos): `api-clients/omdb`,
  `api-clients/tvdb`, `lib/episodes`, `api/admin/tmdb-feed-toggle`,
  `api/debug/{balloonerismm,movieofthenight,omdb,tmdb,watchmode}`, `api/dev/pt-br-probe`.
- Corrigido `src/attribution/api-sources.ts` (+ guard em `helpers.ts`): registro de
  créditos agora reflete apenas as fontes reais (Trakt, JustWatch).

## 6. Fonte de verdade e regra de manutenção

- **`docs/POPLOG_SYSTEM_OVERVIEW.md`** é a fonte de verdade descritiva do estado real.
- **`docs/architecture/POPLOG_GLOBAL_UNIFICATION_PLAN.md`** é a fonte de verdade de
  pendências e ordem de migração.
- `docs/modules/*` são aprofundamentos por módulo; em caso de conflito, o mestre vence.
- `docs/archive/*` é histórico imutável — não deve ser citado como estado atual.
- Regra: ao mudar um sistema crítico, atualizar o mestre na mesma entrega.
