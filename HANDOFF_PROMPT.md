# Handoff Prompt — Watchlist Hydration & Library Duration Fix

## Projeto
Next.js App Router + Supabase + TMDB API. App de tracking de séries/filmes.
Pasta: `I:\poplog-v3` (ou `/sessions/ecstatic-practical-cori/mnt/poplog-v3/` no bash)

---

## O que já foi feito (funcionando)

### 1. `src/server/library/library-service.ts`
Função `resolveLibraryRuntimeFields` calcula duração para todos os itens da biblioteca.
- Cascata de episódios: `aired_episodes` (poplog3_episodes) → `number_of_episodes` (TMDB) → `knownEpisodeCount` (episodeRuntimesMap)
- `durationSortMinutes`: usa tempo restante se > 0, senão total
- `effectiveRuntimeLabel`: se `watchedEpisodes === 0` → tempo total; senão → tempo restante
- Em `getUserLibraryState`: chama `getSeriesEpisodeRuntimesMap` e `getAiredEpisodeCountsMap` em paralelo
- Prioridade: `airedEpisodeCountsBySeriesState.get(tmdbId) || row.aired_episodes` (DB fresco primeiro)

### 2. `src/features/library/LibraryPage.tsx`
- `isPureWatchlist(item)` → `status === 'watchlist' && watched_episodes === 0`
- `isMarathoning(item)` → série: `status === 'watching' && (watched_episodes > 0 || computed_state === 'in_progress')`
- Aba Watchlist filtra por `isPureWatchlist` (não por `status === 'watchlist'`)
- Hook `useWatchlistHydration(library, activeTab)`:
  - Dispara quando `activeTab === 'watchlist'` e há séries TV não iniciadas
  - Loop: chama `POST /api/library/watchlist-hydrate` até `remaining === 0`
  - `sessionChecked` ref → só uma checagem por sessão de navegação
  - Chama `router.refresh()` apenas se `hydrated > 0`

### 3. `src/app/api/library/watchlist-hydrate/route.ts` (novo arquivo, 167 linhas)
- Critério de "já hidratada": tem ao menos 1 episódio com `runtime > 0` em `poplog3_episodes`
- Processa 3 séries por chamada (respeita rate-limit TMDB)
- Para cada série: `syncTmdbTitle` → `syncTmdbSeason` (todas as temporadas) → atualiza `aired_episodes` em `user_title_state`
- Retorna `{ ok, hydrated, failed, remaining, results }`
- `remaining > 0` → cliente chama novamente

---

## Estado atual do banco (Supabase)
- ~13 séries da watchlist tinham `aired_episodes` stale → já corrigidas via SQL UPDATE
- Demon Slayer: tinha `status=watchlist, watched=55` (inconsistência) → corrigido para `status=watching, watched=55, aired=63, computed_state=in_progress`
- Séries watchlist sem episódios em `poplog3_episodes` (~13 títulos) → **serão hidratadas automaticamente** quando o usuário abrir a aba watchlist pela 1ª vez

---

## O que PRECISA SER TESTADO/VALIDADO agora

O sistema de hidratação foi implementado mas ainda não foi testado no browser.

**O que verificar:**
1. Abrir `/biblioteca?tab=watchlist` no browser
2. Confirmar que o hook `useWatchlistHydration` dispara e chama `/api/library/watchlist-hydrate`
3. Confirmar que as ~13 séries sem dados são hidratadas em batches de 3
4. Confirmar que na 2ª visita à aba, `sessionChecked.current === true` impede re-disparo
5. Confirmar que séries que já tinham dados (runtime > 0 em poplog3_episodes) são puladas

**Possíveis bugs a checar:**
- `useEffect` dependency array: `[activeTab]` — correto, mas garantir que não re-aciona
- `router.refresh()` pode causar loop se a página re-renderiza e seta `sessionChecked = false` (pois é uma ref, não deveria resetar)
- Se `syncTmdbSeason` falha para todas as temporadas de uma série, ela fica "não hidratada" e será reprocessada na próxima sessão (correto por design)

---

## Arquivos-chave

```
src/
  app/api/library/watchlist-hydrate/route.ts   ← novo, persistência de hidratação
  features/library/LibraryPage.tsx             ← hook useWatchlistHydration, isPureWatchlist
  server/library/library-service.ts            ← resolveLibraryRuntimeFields, getAiredEpisodeCountsMap
  server/sync/sync-tmdb-season.ts              ← sincroniza episódios de uma temporada
  server/sync/sync-tmdb-title.ts               ← sincroniza metadados do título
  server/runtime/series-episode-runtimes.ts    ← getSeriesEpisodeRuntimesMap
```

---

## ATENÇÃO: Bug de truncamento de arquivo

As ferramentas Edit/Write **truncam arquivos longos** (>~550 linhas) silenciosamente.
**Sempre usar Python para modificar arquivos grandes:**

```bash
python3 - << 'EOF'
path = "/sessions/ecstatic-practical-cori/mnt/poplog-v3/src/CAMINHO/arquivo.ts"
with open(path, 'r') as f:
    content = f.read()
content = content.replace('STRING_EXATA_ANTIGA', 'NOVA_STRING', 1)
with open(path, 'w') as f:
    f.write(content)
print(f"Linhas: {content.count(chr(10))}")
EOF
```

Verificar tamanho depois: `wc -l /sessions/.../arquivo.ts`

---

## Erro TypeScript pré-existente (NÃO introduzido por estas mudanças)

`src/server/library/library-service.ts` linha ~612 tem erro `')' expected` na função `removeUserTitle`.
Confirmado via git como pré-existente. Não tocar nessa área.

---

## Próximos passos sugeridos

1. **Testar a hidratação no browser** — abrir watchlist, verificar nos logs do servidor que o endpoint é chamado, e confirmar que as séries ganham dados de runtime
2. **Verificar duração na watchlist** — depois da hidratação, ordenar por "Mais curto/Mais longo" deve funcionar para todas as ~26 séries
3. Se alguma série ainda não aparece com duração após hidratação: verificar se `poplog3_episodes` tem `runtime > 0` para ela via SQL:
   ```sql
   SELECT series_tmdb_id, COUNT(*) as eps, AVG(runtime) as avg_runtime
   FROM poplog3_episodes
   WHERE series_tmdb_id IN (SELECT tmdb_id FROM user_title_state WHERE status='watchlist' AND watched_episodes=0)
   AND season_number > 0
   GROUP BY series_tmdb_id;
   ```
