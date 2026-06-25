# Plano de Migração da UI do Radar para Payload V2

Status: implementado para a UI principal de `/radar`; compatibilidade legada permanece apenas no endpoint com `legacy=1`.

## Objetivo concluído

A tela `/radar` passou a consumir diretamente o payload V2 de `/api/radar`, mantendo Trakt como fonte principal para calendários, estreias, datas, episódios, lançamentos e tendências.

A regra de produto permanece:

- Trakt decide datas, janelas, estreias e eventos estruturais.
- POPLOG resolve identidade IMDb/local, locale, assets, cache e apresentação.
- A UI não deve voltar a depender de `/api/ics/agenda` nem de formatos duplicados.

## Estado atual

- `/api/radar` entrega `RadarPayload` V2 por padrão.
- A compatibilidade antiga fica somente atrás de `legacy=1` para consumidores externos temporários.
- A página server-side passa `RadarPayload` V2 diretamente para `RadarV2Client`.
- A UI não chama mais `/api/radar?...legacy=1`.
- O antigo `RadarClient.tsx` foi removido.
- A UI V2 possui blocos `Para mim`, `Acompanhando`, `Hoje`, `Semana`, `Em breve` e `Descoberta`.
- A alternância Geral/Para mim consome `/api/radar?mode=general` e `/api/radar?mode=personal`, sem payload legado.

## Etapas concluídas

1. `RadarV2Client` criado consumindo `RadarPayload` diretamente.
2. Blocos V2 implementados sem recriar o payload legado.
3. `page.tsx` troca a conversão legada por `initialPayload`.
4. Fetches do cliente usam `/api/radar?mode=general` e `/api/radar?mode=personal`.
5. Personalização continua via `applyRadarPersonalFilter`.
6. O cliente antigo com `legacy=1` foi removido.
7. Smoke HTTP de `/radar` confirmou página 200 sem `legacy=1`.

## Critérios de aceite

- Nenhuma chamada da UI do Radar usa `legacy=1`.
- `/radar` renderiza com o payload V2 inicial vindo do servidor.
- Alternância Geral/Personalizado funciona sem recarregar a página.
- Filtros continuam contando corretamente por conteúdo, evento e janela.
- Cards exibem título localizado, data, poster/backdrop, badge e identidade IMDb/local quando disponível.
- O Radar continua funcionando quando Trakt falha parcialmente, usando cache local/stale quando existir.
- O endpoint `/api/radar?legacy=1` permanece temporariamente apenas como compatibilidade, não como dependência da UI.

## Testes obrigatórios pós-Radar

- Radar geral.
- Radar personalizado.
- Acompanhando.
- Biblioteca.
- Watchlist.
- Progresso de episódios.
- Cards de eventos.
- Filtros.
- Preparação de notificações internas.
- Workers de eventos.
- Cache/stale.
- Mobile.

## Auditoria visual pós-Radar

Depois da reformulação, repetir a auditoria visual em:

- `/radar`;
- Acompanhando;
- página de título de série;
- Biblioteca;
- cards de eventos;
- filtros;
- mobile.
