# POPLOG Feedback Engine Rework

Status: marco zero arquitetural, antes do refactor de UI.

Este documento consolida a investigacao estrutural do sistema de feedback e preferencias do POPLOG. A direcao e transformar likes, dislikes, favoritos, "nao tenho interesse", hidden, boosts e dismissals em uma engine editorial global, consistente e centralizada.

## Diagnostico

Hoje existem tres centros de verdade parcialmente sobrepostos:

- `user_titles`: biblioteca e status operacional, mas ainda guarda `favorite` e `liked`.
- `user_title_state`: estado materializado para leitura rapida, tambem espelha `favorite` e `liked`.
- `user_title_feedback`: inicio da nova camada editorial, mas ainda quase sem integracao real.

O Supabase em producao confirma que `user_title_feedback` existe e aceita:

- `not_interested`
- `liked`
- `disliked`
- `hidden`
- `boosted`
- `dismissed_from_section`

Na pratica, porem, a tabela esta sendo usada quase exclusivamente para `not_interested`. Likes, dislikes e favoritos ainda operam principalmente pelo modelo antigo.

## Problemas Estruturais

- `favorite` e `liked` estao duplicados em `user_titles` e `user_title_state`.
- Existem divergencias reais de `liked` entre `user_titles` e `user_title_state`.
- Opiniao e progresso ainda estao acoplados.
- Alguns fluxos podem transformar like/dislike em `watched`.
- `user_events` existe, mas ainda nao e usado como historico imutavel.
- Ranking editorial nao usa uma camada global unica.
- Busca, Trending, Discover e recomendacoes ainda ignoram boa parte do feedback.
- Existe drift entre migrations locais e schema remoto do Supabase.

O banco possui um trigger chamado `neutralize_negative_feedback_on_positive_title_state`. Ele apaga feedbacks negativos quando um titulo vira favorito, watchlist, watched ou watching. Esse comportamento e incompatível com a nova arquitetura, porque destroi informacao historica bruta.

## Separacao Alvo

`user_titles`

- Guarda apenas biblioteca e progresso operacional.
- Exemplos: `status`, `watched_at`, `fridge`, dados de watchlist.
- Nao deve ser a fonte final de opiniao editorial.

`user_title_feedback`

- Guarda preferencias explicitas do usuario.
- Deve preservar informacao bruta sempre que possivel.
- Deve aceitar feedback global, contextual e temporario.

`user_title_state`

- Guarda estado materializado e derivado para leitura rapida.
- Deve refletir a resolucao editorial atual, nao substituir o historico bruto.

`user_events`

- Guarda historico imutavel de acoes.
- Deve registrar mudancas de feedback, biblioteca, progresso e sincronizacao.

## Semantica Editorial

Hierarquia base:

```text
favorite > liked > neutral > not_interested > disliked > hidden
```

`favorite`

- Afinidade maxima.
- Nao e apenas um like forte.
- Tem prioridade editorial maxima.
- Sempre vence `liked` quando ambos existem.
- Aumenta persistencia em Hero, Radar, For You e recomendacoes.
- Tem maior resistencia a decay e ocultacao.
- Neutraliza sinais negativos leves.

`liked`

- Opiniao positiva explicita.
- Deve gerar boost medio/alto.
- Nao deve marcar `watched` automaticamente.
- Remove ou neutraliza sinais leves de baixo interesse.

`disliked`

- Usuario consumiu ou conhece e nao gostou.
- Penalidade media.
- Nao deve marcar `watched` automaticamente.
- Nao deve apagar historico de biblioteca.

`not_interested`

- Baixo interesse ou falta de vontade de consumir agora.
- Penalidade forte, mas reversivel.
- Nao deve apagar historico assistido.
- Pode ser neutralizado por favorite, liked, watchlist, watching ou watched.

`hidden`

- Ocultacao global rara.
- Deve excluir quase totalmente, exceto em superficies onde a busca explicita precisa prevalecer.

`dismissed_from_section`

- Ocultacao contextual temporaria.
- Deve possuir `surface`, `section_key` e `expires_at`.
- Nao deve afetar todo o produto.

`boosted`

- Reforco contextual ou editorial.
- Pode ser usado por experimentos, curadoria, resurfacing e continuidade.

## Regras De Conflito

- Favorito tem prioridade maior que liked.
- Favorito neutraliza `not_interested`, `disliked` leve e dismissal contextual.
- Favorito nao deve apagar feedback bruto antigo.
- Liked neutraliza `not_interested` e pode neutralizar `disliked` leve.
- Hidden vence quase tudo, exceto revisao explicita pelo usuario.
- `not_interested` nao apaga watched, watching, watchlist ou favorite.
- `disliked` nao marca watched.
- `liked` nao marca watched.
- Watchlist, watching, watched e favorite neutralizam conflitos leves no estado derivado.
- Hidden nao deve ser neutralizado automaticamente por watchlist, watching ou watched.
- Dismissal contextual deve expirar.
- Feedback bruto deve ser preservado por padrao.

## Pesos Iniciais

Pesos por sinal:

| Sinal | Peso editorial |
| --- | ---: |
| favorite | +100 |
| liked | +35 |
| boosted | +20 |
| dismissed_from_section | -25 |
| disliked | -45 |
| not_interested | -70 |
| hidden | -1000 |

Multiplicadores por superficie:

| Superficie | Multiplicador |
| --- | ---: |
| hero | 1.60 |
| for_you | 1.35 |
| radar | 1.20 |
| acompanhando | 1.00 |
| trending | 0.70 |
| search | 0.25 |
| title_page | 0.10 |

Busca deve respeitar `hidden`, mas nao deve remover resultados por `not_interested`; deve apenas rebaixar ou contextualizar.

## Surface Canonica

`radar` e a surface oficial para a antiga area de Agenda.

Durante a transicao:

- callers legados podem enviar `agenda`;
- a engine aceita `agenda` como alias;
- internamente todo feedback, scoring, metadata e evento deve ser normalizado para `radar`;
- novos writes nao devem persistir `agenda`.

Isto evita que metade do produto aprenda preferencias em `agenda` e a outra metade em `radar`.

## Evolucao De Schema

Evoluir `user_title_feedback` de forma aditiva:

- `surface`
- `scope`
- `section_key`
- `expires_at`
- `active`
- `metadata`
- `strength`
- `confidence`

Evoluir `user_title_state` de forma aditiva:

- `editorial_affinity`
- `editorial_penalty`
- `editorial_score`
- `has_negative_feedback`
- `is_hidden`
- `is_boosted`
- `last_feedback_type`
- `last_feedback_at`

Nenhuma dessas mudancas deve remover colunas legadas no primeiro ciclo.

## Engine Central

Criar `applyTitleFeedback()` como unico caminho oficial para feedback e preferencias.

Responsabilidades:

- Validar input.
- Persistir feedback explicito.
- Resolver conflitos por estado derivado.
- Sincronizar `user_title_state`.
- Registrar `user_events`.
- Retornar estado consolidado para UI e hooks.
- Emitir informacao suficiente para invalidao/revalidacao das superficies.

O fluxo deve ser aditivo. Endpoints antigos podem continuar existindo temporariamente, mas devem chamar a engine por baixo.

Derivacao atual esperada:

- `editorial_affinity`: parcela positiva global, com favorito no topo.
- `editorial_penalty`: parcela negativa global, sem apagar feedback bruto.
- `editorial_score`: score global derivado, antes de multiplicador de superficie.
- `has_negative_feedback`: verdadeiro quando ha penalidade ativa.
- `is_hidden`: verdadeiro somente quando hidden nao foi neutralizado.
- `is_boosted`: verdadeiro quando existe boost ativo.
- `last_feedback_type` e `last_feedback_at`: ultima acao processada pela engine.
- `persistenceScore` e `decayResistance`: protecoes editoriais onde `favorite` tem o maior valor.

## Estrategia De Transicao

1. Reconciliar migrations locais vs producao.
2. Formalizar schema real atual.
3. Criar politica editorial pura e testavel.
4. Criar `applyTitleFeedback()` de forma aditiva.
5. Registrar `user_events` em toda acao de feedback.
6. Fazer backfill controlado:
   - `favorite = true` vira afinidade maxima.
   - `liked = true` vira `liked`.
   - `liked = false` vira `disliked`.
7. Manter compatibilidade temporaria com campos legados.
8. Parar resets silenciosos de `favorite` e `liked`.
9. Substituir trigger destrutivo por derivacao explicita.
10. Migrar endpoints e hooks.
11. Integrar scoring global em Hero, For You, Radar, Trending, Busca, Pagina de Titulo, Biblioteca e Acompanhando.
12. Remover dependencias legadas apenas depois da estabilizacao.

## Primeira Migration Local

Arquivo preparado:

- `supabase/migrations/20260522000100_feedback_engine_schema.sql`

Esta migration e aditiva. Ela:

- garante `user_title_feedback` em ambientes onde a tabela ainda nao exista;
- adiciona campos editoriais/contextuais em `user_title_feedback`;
- adiciona campos derivados em `user_title_state`;
- cria indices para leitura por feedback ativo, contexto e score editorial;
- normaliza `surface = 'agenda'` para `surface = 'radar'`;
- substitui a funcao destrutiva `neutralize_negative_feedback_on_positive_title_state()` por uma versao nao destrutiva.

Ela ainda nao remove a constraint unica legada de `user_title_feedback`, porque o endpoint atual usa `upsert` por `user_id, tmdb_id, media_type, feedback_type`. A evolucao para multiplos dismissals por `surface`/`section_key` deve acontecer em uma segunda etapa, junto com a troca dos callers.

## Riscos

- Drift entre migrations locais e Supabase remoto.
- Trigger destrutivo apagando informacao historica.
- Mudancas de RLS podem quebrar producao se aplicadas sem ensaio.
- Backfill de feedback pode alterar ranking de varias superficies ao mesmo tempo.
- `favorite` precisa continuar com prioridade editorial maxima durante toda a transicao.

## Fora Do Primeiro Ciclo

- Refactor visual.
- Remocao de colunas legadas.
- Mudancas destrutivas de dados.
- Hardening de RLS nao relacionado ao feedback.
- Personalizacao pesada de Trending antes da engine base estar estavel.
