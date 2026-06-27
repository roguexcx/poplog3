# RADAR - Guia técnico do estado atual

Atualizado em 2026-06-25.

## Resumo

O Radar atual é V2-first na interface principal. A página `/radar` consome `RadarPayload` diretamente de `/api/radar`, sem depender do formato legado na UI.

A fonte estrutural principal é Trakt, usada para calendários, datas, episódios, estreias, lançamentos e tendências quando fizer sentido. A regra de produto é: a fonte externa entrega eventos e identificadores; o POPLOG monta a apresentação final com identidade local/IMDb, idioma, região, assets, cache e disponibilidade normalizada.

## Arquivos principais

| Área | Arquivo | Responsabilidade |
|---|---|---|
| Página | `src/app/radar/page.tsx` | Carrega idioma/região, busca payload inicial V2 e renderiza o cliente V2. |
| Cliente | `src/app/radar/RadarV2Client.tsx` | Renderiza blocos, busca, filtros, alternância Geral/Para mim e cards V2. |
| API | `src/app/api/radar/route.ts` | Entrega `RadarPayload` por padrão e mantém compatibilidade antiga apenas atrás de `legacy=1`. |
| Engine | `src/server/radar-trakt/radar-trakt-engine.ts` | Monta eventos a partir de Trakt e enriquecimento local. |
| Buckets | `src/server/radar-trakt/radar-event-buckets.ts` | Organiza eventos em seções V2. |
| Cache | `src/server/radar-trakt/radar-cache.service.ts` | Cache persistente/versionado do payload. |
| Tipos | `src/server/radar-trakt/types.ts` | Contrato `RadarPayload`, eventos, filtros e estatísticas. |

## Fluxo

```text
Usuário entra em /radar
  -> page.tsx resolve language/region
  -> getRadarPayload(mode, language, region)
  -> RadarV2Client recebe RadarPayload inicial
  -> usuário alterna Geral/Para mim ou filtros
  -> cliente chama /api/radar?mode=general|personal&language=...&region=...
  -> API retorna payload V2
```

## Blocos da UI

- Para mim.
- Acompanhando.
- Hoje.
- Semana.
- Em breve.
- Descoberta.

## Compatibilidade

O endpoint `/api/radar?legacy=1` permanece temporariamente para consumidores externos antigos. A UI principal não chama esse modo.

## Validação

- `npm run smoke:local-http`: cobre `/radar` e `/api/radar`.
- Smoke direto de `/api/radar?mode=general&language=pt-BR&region=BR`: payload V2 com `sections`, `filters` e `stats`, sem estrutura legada duplicada.
- Smoke direto de `/radar`: status 200 e página sem `legacy=1`.

## Próximos cuidados

- Repetir auditoria visual quando a validação multi-browser/mobile for retomada.
- Evoluir notificações e personalização fina sem recriar dependência de formato legado.
