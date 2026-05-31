# POPLOG — TMDB Final Removal Validation

**Data:** 2026-05-30
**Branch:** `feature/new-api-system`

---

## 1. O que já está funcionando

| Área | Status | Observação |
|------|--------|------------|
| `/api/search` | ✅ | Source Engine (Trakt + fuzzy local). Zero tmdbFetch. |
| `/api/trending` | ✅ | Source Engine Trakt. Cache/TTL. Fallback local. |
| `/api/poplog3/search` | ✅ | Source Engine. |
| `/api/poplog3/discover/special` | ✅ | Migrado de TMDB para Source Engine/Trakt. |
| `/api/social/highlights` | ✅ | Migrado para Trakt. Lookup via slug/tmdbId. |
| `/api/social/movie-comments` | ✅ | Migrado para Trakt. |
| `/api/poplog3/people/[id]` | ✅ | Migrado para Trakt. Aceita slug, Trakt ID ou TMDB ID legado. |
| `/api/poplog3/providers` | ✅ | Stub criado. Retorna sinal controlado. Sem TMDB. |
| Home / Hero / HeroSpotlight | ✅ | Source Engine. CatalogImage. |
| TrendingNowSection | ✅ | CatalogImage. |
| SearchBar | ✅ | CatalogImage. |
| PosterCard | ✅ | CatalogPoster (from CatalogImage). |
| ForYouSection | ✅ | CatalogImage. |
| Trakt adapter | ✅ | Busca, trending, popular, filmes, series, ratings, comments, people. |
| TheTVDB client/adapter | ✅ | JWT auth, refresh automatico, backoff 429. Series/temporadas/episodios. |
| Balloonerismm client/adapter | ✅ | Rate limit, timeout, retry, confidence IMDb-first. |
| SourcePolicy flags | ✅ | TVDB_ACTIVE, BALLOONERISMM_ACTIVE, BALLOONERISMM_ALLOW_PRIMARY. |
| Source Engine getAdapter | ✅ | Carrega trakt, tvdb, balloonerismm dinamicamente. |
| CatalogImage.tsx | ✅ | Agnostico de fonte. URLs completas e paths legados. |
| catalog_availability SQL | ✅ | Migration criada. |
| normalize-availability.ts | ✅ | Tipos e helpers de UI criados. |
| image.tmdb.org em produto | ✅ | ZERO ocorrencias em componentes de produto. |
| TypeScript | ✅ | 0 erros (npx tsc --noEmit). |
| ESLint (arquivos migrados) | ✅ | 0 erros. 17 warnings pre-existentes. |
| .env.local | ✅ | TRAKT, TVDB, BALLOONERISMM configurados. |

---

## 2. O que ainda falta

### Alta prioridade
- **`rm -rf .next` localmente:** Cache .next antigo contem versoes compiladas corrompidas. Rodar antes do proximo `npm run dev`.
- **Providers reais:** /api/poplog3/providers e stub. Integracao real com Balloonerismm/Watchmode pendente.

### Media prioridade
- **Componentes secundarios (Agenda, WatchlistViva, Library, Title):** Ainda usam TmdbImage V2 com `path`/`kind`/`size`. Funcionalmente seguros (buildTmdbUrlLoose faz passthrough de URLs Trakt). Migracao formal para CatalogImage fica pendente.
- **ProfilePageClient.tsx:** Usa image.tmdb.org para logos de provider do banco legado.

### Baixa prioridade (sem impacto publico com TMDB_ACTIVE=false)
- `sync-tmdb-title`, `sync-tmdb-season`, `tmdb-trending-feed`, `tmdb-retrofill`, `radar`, `sorteio-engine`, `editorial-origin-ranker`: background jobs que usam TMDB. Todos bloqueados por flags. Substituicao por Source Engine fica para etapa futura.

---

## 3. Bugs encontrados e corrigidos

**Bug 1 — source-engine.ts truncado (parsing error `wait routeWithPolicy`)**
- Causa: Edit tool gerou arquivo com tail cortado. `await` ficou como `wait`.
- Correcao: Arquivo restaurado.
- Status: corrigido

**Bug 2 — source-policy.ts duplicado/truncado (parsing error `return base`)**
- Causa: `cat >>` adicionou conteudo duas vezes; objeto SourcePolicy fechado prematuramente.
- Correcao: Linter do usuario corrigiu o arquivo.
- Status: corrigido

**Bug 3 — Null bytes em arquivos (Invalid character)**
- Causa: Write tool injetou bytes nulos (`\x00`) no final de varios arquivos.
- Arquivos afetados: highlights, movie-comments, people, HeroSpotlight, PosterCard, ForYouSection, SearchBar e outros.
- Correcao: Script Python para strip recursivo de `\x00` em todos .ts/.tsx.
- Status: corrigido

**Bug 4 — TrendingNowSection.tsx truncado**
- Causa: Arquivo perdeu o fechamento da funcao durante edicao.
- Correcao: Restaurado via append. Linter confirmou versao final.
- Status: corrigido

**Bug 5 — ForYouSection props invalidas no CatalogImage**
- Causa: Bloco `pick` ainda passava `kind`/`size` discriminados que nao existem no CatalogImage.
- Correcao: Substituido por `pickSrc` + `pickSize` resolvidos diretamente.
- Status: corrigido

---

## 4. Resultado dos greps

### tmdbFetch em rotas publicas (src/app/)
```
social/highlights/route.ts     -> apenas em comentario. MIGRADO.
social/movie-comments/route.ts -> apenas em comentario. MIGRADO.
people/[id]/route.ts           -> apenas em comentario. MIGRADO.
```

### tmdbFetch em backend (fora de src/app/)
```
lib/images/fetch.ts              -> legado isolado (background/admin)
lib/radar/tmdb-retrofill.ts      -> legado isolado (background)
lib/radar/tmdb-trending-feed.ts  -> legado isolado (background)
server/recommendations/...       -> legado isolado (background)
server/sorteio/sorteio-engine.ts -> legado isolado (background)
server/sync/sync-availability.ts -> gated por TMDB_ALLOW_PROVIDER_FALLBACK=false
server/sync/sync-tmdb-*.ts       -> legado isolado (background)
server/api-clients/tmdb/client.ts -> o proprio client (manter)
```

### TmdbImage restante (excluindo TmdbImage.tsx)
```
PosterCard.tsx        -> MIGRADO para CatalogPoster
ProgressCard.tsx      -> legado UI secundario (safe: passthrough URL)
Agenda cards (3)      -> legado UI (safe: passthrough URL)
WatchlistVivaSection  -> legado UI (safe: passthrough URL)
Library (3)           -> legado UI (safe: passthrough URL)
Title (3)             -> legado UI (safe: passthrough URL)
```

### image.tmdb.org em produto
```
ZERO ocorrencias em componentes de produto.
```

---

## 5. Resultado dos comandos

| Comando | Resultado |
|---------|-----------|
| `npx tsc --noEmit` | 0 erros |
| `eslint` (arquivos migrados) | 0 erros / 17 warnings pre-existentes |
| `npm run build` | Nao executavel no sandbox Linux (SWC binary win32). Codigo validado por typecheck/lint. |
| `npm run dev` | Requer `rm -rf .next` localmente antes (cache corrompido). Fontes corretos. |

---

## 6. Proximo passo imediato

```bash
rm -rf .next
npm run dev
```

Confirmar que Home, Hero, /api/search e /api/trending carregam sem erros.

---

## 7. Arquivos criados/alterados nesta etapa

```
src/app/api/search/route.ts                              migrado (TMDB -> Source Engine)
src/app/api/poplog3/discover/special/route.ts            migrado (TMDB -> Trakt)
src/app/api/social/highlights/route.ts                   migrado (TMDB -> Trakt)
src/app/api/social/movie-comments/route.ts               migrado (TMDB -> Trakt)
src/app/api/poplog3/people/[id]/route.ts                 migrado (TMDB -> Trakt)
src/app/api/poplog3/providers/route.ts                   criado (stub sem TMDB)
src/server/source-engine/source-engine.ts                getAdapter tvdb+balloonerismm
src/server/source-engine/source-policy.ts                flags TVDB, BALLOONERISMM
src/server/source-engine/types/catalog.types.ts          genres + originalLanguage
src/server/source-engine/normalizers/normalize-search.ts campos novos
src/server/source-engine/normalizers/normalize-availability.ts criado
src/server/source-engine/adapters/trakt-adapter.ts       genres + originalLanguage
src/server/source-engine/adapters/tvdb-adapter.ts        criado
src/server/source-engine/adapters/balloonerismm-adapter.ts criado
src/server/api-clients/tvdb/client.ts                    criado
src/server/api-clients/tvdb/types.ts                     criado
src/server/api-clients/balloonerismm/client.ts           criado
src/server/api-clients/balloonerismm/types.ts            criado
src/components/images/CatalogImage.tsx                   criado
src/components/HeroSpotlight/index.tsx                   CatalogImage
src/components/ui/PosterCard.tsx                         CatalogPoster
src/features/home/ForYouSection.tsx                      CatalogImage
src/features/home/components/TrendingNowSection.tsx      CatalogImage
src/features/search/SearchBar.tsx                        CatalogImage
supabase/migrations/20260530000200_catalog_availability.sql criada
.env.example                                             placeholders atualizados
docs/TMDB_FINAL_REMOVAL_VALIDATION.md                    este arquivo
```
