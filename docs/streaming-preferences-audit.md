# Auditoria: Sistema Global de Preferências de Streaming

**Data:** 2026-05-26  
**Referência positiva:** Biblioteca (`/library`) — estado materializadopor `user_title_state.best_provider_*`

---

## Como o sistema funciona (base técnica)

O sistema de preferências de streaming tem **dois mecanismos** distintos:

### Mecanismo 1 — Campos materializados em `user_title_state`
Os campos `best_provider_name`, `best_provider_type` e `best_provider_logo` são calculados e gravados no banco **quando o usuário altera suas preferências** (via `PUT /api/user/streaming-preferences`, que chama `refreshAllUserTitleAvailability`), e também **quando um título é adicionado/atualizado** na biblioteca. Qualquer tela que leia esses campos do banco já herda automaticamente as preferências — sem chamada adicional em runtime.

### Mecanismo 2 — Cálculo on-demand via `getUserProviderPreferences()`
Chamado por endpoints que precisam ranquear providers em tempo real. Lê `user_streaming_preferences` do banco e retorna `ProviderPreferenceInput` com `favoriteProviderIds` ordenados. Usado por `rankAvailabilityProviders()` para filtrar/ordenar a lista de providers de um título.

---

## Status por seção

### ✅ Biblioteca (`/library`)
**Mecanismo:** materializados (`best_provider_*` de `user_title_state`)  
**Resultado:** Praticamente todos os títulos exibem tag de streaming — comportamento esperado e confirmado funcionando.  
**Como chega:** `getUserLibraryState()` lê os campos diretamente do state. O `best_provider_logo` aparece no card de cada título.

---

### ⚠️ Home (`/`)

| Bloco | Endpoint | Usa preferências? | Como |
|---|---|---|---|
| **Hero editorial** | TMDB direto (server component) | ❌ Não | Baseado em trending, sem provider |
| **Trending Now** | `/api/trending` | ❌ Não | Lista TMDB pura, sem provider |
| **ForYou** | `/api/user/for-you` | ❌ Não | Personalização por gênero/histórico, sem provider |
| **Watchlist Viva** | `/api/watchlist/live` | ✅ Sim | Chama `getUserProviderPreferences()` on-demand, ranqueia e retorna `providers[]` |

**Diagnóstico:** A WatchlistVivaSection é o único bloco da Home que consome preferências ativamente. ForYou e TrendingNow não exibem provider nenhum (by design por ora), mas se futuramente receberem badges de "disponível no seu streaming", precisarão do mecanismo.

---

### ⚠️ Acompanhando (`/acompanhando`)

| Bloco | Endpoint | Usa preferências? | Como |
|---|---|---|---|
| **Hero Spotlight** | `/api/poplog3/continuity/hero` | ✅ Sim | `hero-candidates.ts` chama `getUserProviderPreferences()` e aplica bônus de score para providers favoritos (`favoriteProvider +80/95/120pts`). Exibe "No seu streaming favorito: X" |
| **Novos episódios** | `/api/poplog3/continuity/new-episodes` | ❌ Não | Sem campo de provider no payload |
| **Continue de onde parou** | `/api/poplog3/continuity/continue` | ❌ Não | Sem campo de provider no payload |
| **O que ver primeiro?** | `/api/poplog3/continuity/watchlist-picks` | ✅ Indireto | Lê `best_provider_*` de `user_title_state` (materializados). Badge "No seu streaming" calculado a partir de `best_provider_type`. Ordering score favorece `subscription > free > rent`. |
| **Boa hora pra começar** | `/api/poplog3/continuity/watchlist-picks?seriesStart=1` | ✅ Indireto | Mesmo mecanismo acima |
| **Últimos vistos** | `/api/poplog3/continuity/recently-watched` | ❌ Não | Sem campo de provider |

**Diagnóstico:** Hero e Watchlist Picks cobrem os casos mais visíveis. Os blocos "Novos episódios", "Continue" e "Últimos vistos" são funcionais sem provider porque o CTA é "continuar assistindo" — o usuário já sabe onde está. A ausência de provider nesses blocos é defensível, mas haveria ganho em exibir o badge para reduzir atrito ("ainda na Netflix").

---

### ✅ Título individual (`/title/[mediaType]/[id]`)
**Mecanismo:** on-demand via `getUserProviderPreferences()`  
**Resultado:** `get-title-page-data.ts` chama `getUserProviderPreferences()` e passa as preferências para `getAvailabilityForDisplay()`. O componente `TitleProviders` exibe destaque visual (borda ciano + badge "Seu streaming") nos providers favoritos via `isPreferred`. **É a implementação mais completa do sistema.**

---

### ❌ Busca (`/buscar`)
**Mecanismo:** Nenhum  
**Resultado:** Os resultados de busca (`SearchPageView`) não exibem nenhuma informação de provider. O `SearchResult` type não tem campos de disponibilidade. Os endpoints `/api/poplog3/search` e `/api/poplog3/search/discovery` retornam apenas metadados TMDB.  
**Impacto:** Usuário busca "Succession" e não vê que está na Max (seu streaming favorito). Sem badge de disponibilidade, sem ordenação por preferência.

---

### ⚠️ Radar (`/radar`)
**Mecanismo:** `streamingProvider` populado pelo `agenda-engine` a partir de `availability_title_state` — dados gerais, **não filtrados pelas preferências do usuário**  
**Resultado:** O Radar exibe `streamingProvider.name` em alguns eventos (exibe o nome do provider para estreias de streaming), mas não aplica ranking de preferência nem destaca providers favoritos. Não há `isPreferred` nem reordenação.  
**Como funciona:** O campo `streamingProvider?: { name: string }` no `IcsSeriesGroup` é populado pelo pipeline ICS (agenda-engine), que lê disponibilidade de uma tabela de cache global — sem consultar as preferências do usuário logado. O Radar Personalizado filtra por biblioteca do usuário, mas ainda não personaliza providers.  
**Impacto:** Usuário com Netflix como favorito não vê nenhum destaque nas estreias da Netflix no Radar.

---

### ❌ Sorteio (`/sorteio`)
**Mecanismo:** Nenhum  
**Resultado:** O Sorteio busca o pool de títulos em `/api/poplog3/agenda` (nowPlaying + upcoming + airingToday + onTheAir do TMDB). Filtra apenas por tipo (filme/série) e vibe (gênero). Não consulta preferências de streaming em nenhum momento.  
**Impacto:** O Sorteio sorteia um título que pode não estar disponível em nenhum streaming do usuário. Não há filtro "somente meus streamings", não há badge de disponibilidade no card do título sorteado, e não há ordenação do pool por afinidade de provider.

---

## Mapa consolidado

```
Seção              | Mecanismo        | Provider exibido? | Prefêrencia aplicada?
─────────────────────────────────────────────────────────────────────────────
Biblioteca         | materializados   | ✅ badge logo     | ✅ (via refresh batch)
Home – Watchlist   | on-demand        | ✅ lista ranked   | ✅
Home – ForYou      | —                | ❌                | ❌
Home – Trending    | —                | ❌                | ❌
Acomp – Hero       | on-demand        | ✅ "Seu streaming"| ✅ (bônus de score)
Acomp – WL Picks   | materializados   | ✅ badge + score  | ✅ (indireto)
Acomp – New Eps    | —                | ❌                | ❌
Acomp – Continue   | —                | ❌                | ❌
Acomp – Recentes   | —                | ❌                | ❌
Título individual  | on-demand        | ✅ isPreferred    | ✅ (mais completo)
Busca              | —                | ❌                | ❌
Radar              | pipeline ICS     | ⚠️ nome apenas    | ❌ (não personalizado)
Sorteio            | —                | ❌                | ❌
```

---

## Diagnóstico central

A Biblioteca funciona bem porque depende de campos **pré-calculados e gravados no banco** (`user_title_state.best_provider_*`), que são atualizados por um job batch toda vez que o usuário muda suas preferências. Esse mecanismo é robusto e escalável — não adiciona latência por requisição.

As demais seções **não compartilham essa lógica**: cada área faz (ou não faz) sua própria consulta de preferências de forma isolada. Não há um hook client-side centralizado de preferências que as páginas pudessem consumir diretamente.

**Três gaps críticos:**

1. **Sorteio** não consome preferências em nenhuma camada — o pool não é filtrado nem ordenado por streaming do usuário.
2. **Busca** não exibe disponibilidade nos resultados — maior oportunidade perdida de conversão ("já está no seu streaming").
3. **Radar** exibe `streamingProvider` mas sem personalização — vem de dados globais, não da preferência do usuário logado.

---

## Próximos passos sugeridos (por prioridade)

### Alta prioridade

**Sorteio — filtro/priorização por streaming favorito**  
O pool atual é `nowPlaying + upcoming + airingToday + onTheAir` do TMDB. Para aplicar preferências, o endpoint `/api/poplog3/agenda` precisaria cruzar esses títulos com `availability_title_state` e marcar quais estão disponíveis nos streamings do usuário. O Sorteio poderia então ter um filtro "Só meus streamings" e/ou priorizar títulos disponíveis no pool sorteável.

**Busca — badge de disponibilidade nos resultados**  
Ao exibir resultados de busca, consultar em batch `availability_title_state` (ou `user_title_state` para itens já na biblioteca) e exibir o logo do provider favorito ao lado do card. Não exige chamada live — pode ser um campo adicional no payload do search endpoint.

### Média prioridade

**Radar — destacar providers favoritos do usuário**  
O `streamingProvider` no `IcsSeriesGroup` é global. Para personalizar, o endpoint `/api/radar?mode=personal` poderia cruzar os eventos com as preferências do usuário logado e adicionar um campo `isUserFavoriteProvider: boolean`. O `RadarClient` já renderiza o nome do provider — bastaria adicionar o destaque visual.

**Acompanhando — badge em "Novos episódios" e "Continue"**  
Esses endpoints já leem de `user_title_state`. Adicionar `best_provider_name/logo` ao `NewEpisodeItem` e `ContinueItem` é uma mudança pequena (uma linha a mais no SELECT) com impacto visual direto: o usuário vê "próximo ep · Netflix" no card.

### Baixa prioridade

**Home – ForYou e Trending**  
Esses blocos são editoriais/de descoberta e não têm relação direta com disponibilidade imediata. Uma badge discreta ("disponível") pode ser adicionada futuramente, mas não é o caso central de uso das preferências.
