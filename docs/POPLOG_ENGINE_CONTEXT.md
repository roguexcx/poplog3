# POPLOG — Contexto da Engine Própria e Remoção do TMDB

**Data:** 2026-05-31  
**Branch atual:** `main`  
**Status:** Engine isolada em construção antes de aplicar em produção

---

## 1. O que é o POPLOG e onde estamos

POPLOG é uma plataforma pessoal de catálogo e acompanhamento de filmes e séries.
O sistema foi construído inicialmente com **TMDB (The Movie Database)** como fonte central de dados:
busca, trending, detalhes de títulos, imagens, providers (onde assistir), ratings, pessoas, etc.

O objetivo de longo prazo é **substituir 100% o TMDB** por uma **engine própria** que combina:

| Fonte | Papel | Status |
|---|---|---|
| **Trakt** | Base principal: busca, trending, popular, social, calendário | ✅ API ativa, key configurada |
| **TheTVDB** | Especialista em séries: temporadas, episódios, ordens, status, datas | ✅ API ativa, key configurada |
| **Balloonerismm** | IMDb-first: enriquecimento, awards, trivia, providers | 🟡 API disponível, sem autenticação |
| **Cache local (Supabase)** | Estabilidade, redução de chamadas externas | ✅ Ativo |
| **TMDB** | Legado histórico apenas, zero chamadas em runtime público | 🔴 Bloqueado |

---

## 2. O que foi tentado na branch `feature/new-api-system`

Foi criada uma branch com migração extensa. O que foi feito:

### Implementado
- **Source Engine** (`src/server/source-engine/`): ponto único de entrada para dados externos, com adapters, normalizers, cache, scoring, fallback, logs
- **Trakt adapter** completo: busca, trending, popular, filmes, séries, temporadas, episódios, ratings, comments, people, vídeos, calendário
- **TheTVDB client + adapter**: JWT auth, refresh automático, backoff 429, foco em séries/temporadas/episódios
- **Balloonerismm client + adapter**: rate limit, timeout, retry, regras de confiança IMDb-first
- **SourcePolicy**: flags de ativação por fonte (TVDB_ACTIVE, BALLOONERISMM_ACTIVE, etc.)
- `/api/search` migrado para Source Engine (Trakt)
- `/api/trending` validado com Trakt
- `/api/social/highlights` e `/api/social/movie-comments` migrados para Trakt
- `/api/poplog3/people/[id]` migrado para Trakt
- **CatalogImage.tsx**: componente agnóstico de fonte (substituto do TmdbImage)
- **Migration SQL** para `catalog_availability` (providers regionais com fonte, confiança, TTL)
- **Admin**: nova aba "Histórico de APIs" com série temporal por dia/API

### Problemas encontrados

**1. Truncamento de arquivos pelo mount Linux**

O sandbox Linux monta a pasta Windows via rede. Quando arquivos são editados pelo `Edit tool` (que escreve no Windows), o Linux vê versões em cache truncadas. Comandos `cat >>` para restaurar arquivos truncados criaram **conteúdo duplicado** nos arquivos Windows, causando erros de parsing no Next.js/Turbopack.

**Padrão do bug:**
```
// Arquivo Windows tinha:
export async function getCalendar(...) {
  const result = await routeWithPolicy("calendar", ...)  // correto até aqui
}
wait routeWithPolicy("calendar", ...)  // duplicata do cat >> — "a" faltando em "await"
}
```

**Como detectar:** `Read tool` no caminho Windows vs `cat` no bash mostram conteúdos diferentes.  
**Como corrigir:** Python truncando pelo número correto de linhas via o path do mount.

**2. Null bytes em arquivos escritos pelo Write tool**

O `Write tool` ocasionalmente injeta bytes nulos (`\x00`) no final dos arquivos.  
**Causa:** provavelmente padding na transferência Windows ↔ Linux mount.  
**Detecção:** `python3 -c "print(open('FILE','rb').read().count(b'\x00'))"`  
**Correção:** `python3 -c "f='FILE'; c=open(f,'rb').read(); open(f,'wb').write(c.replace(b'\x00',b''))"`

**3. Acoplamento profundo com TMDB no codebase existente**

A migração revelou que TMDB está em ~50 arquivos: sync jobs, title page data, recommendations, radar, sorteio, providers. Migrar tudo de uma vez em uma branch longa criou uma superfície enorme de mudanças, difícil de testar e validar.

**4. O `git checkout -f main` funcionou mas o mount ficou inconsistente**

Após deletar a branch e voltar para `main`, o mount Linux ficou em estado quebrado (`fatal: invalid object name 'HEAD'`), mostrando versões truncadas dos arquivos. O TypeScript do bash reportou ~7000 erros falsos. Os arquivos Windows estão corretos.

---

## 3. Estado atual da `main`

A branch `main` está **inalterada** — usa TMDB para tudo como antes. Os únicos arquivos modificados são:

- `src/lib/images/url.ts`: adicionado `buildTmdbRawUrl` (alias que existia antes, foi removido em algum refactor)
- `src/features/search/SearchPageView.tsx`: import corrigido para `buildTmdbRawUrl`
- `src/server/source-engine/adapters/balloonerismm-adapter.ts`: arquivo órfão da branch deletada (não afeta nada)
- `src/server/source-engine/adapters/tvdb-adapter.ts`: idem
- `src/server/source-engine/normalizers/normalize-availability.ts`: idem
- `src/server/api-clients/balloonerismm/`: pasta criada (client + types)
- `src/server/api-clients/tvdb/`: pasta criada (client + types)

Os arquivos órfãos não causam erros — estão no disco mas não são importados por nada na `main`.

---

## 4. Lição aprendida: Engine Isolada Primeiro

### O erro da abordagem anterior

Tentou-se migrar toda a aplicação de uma vez: rotas públicas, componentes, sync jobs, admin, imagens, providers. A branch cresceu para 200+ arquivos, a surface de bugs ficou enorme, e problemas de mount/parsing criaram um ciclo de correções intermináveis.

### A abordagem correta: Engine em isolamento

**Princípio:** construir a POPLOG Source Engine como um módulo completamente isolado, com testes próprios, antes de conectá-la a qualquer rota ou componente da aplicação.

```
Etapa 1: Engine isolada
  src/server/poplog-engine/          ← novo diretório limpo
    clients/
      trakt.ts                       ← HTTP client Trakt
      tvdb.ts                        ← HTTP client TheTVDB
      balloonerismm.ts               ← HTTP client Balloonerismm
    adapters/
      trakt-adapter.ts               ← implementa CatalogAdapter
      tvdb-adapter.ts                ← idem
    normalizers/
      title.ts, search.ts, etc.      ← contrato interno POPLOG
    cache/
      section-cache.ts               ← cache de seções (trending, popular)
      payload-cache.ts               ← cache de payloads individuais
    router.ts                        ← fallback chain: Trakt → TVDB → local
    policy.ts                        ← flags de ativação por fonte
    index.ts                         ← API pública da engine
  
  scripts/test-engine.ts             ← script standalone para testar sem servidor

Etapa 2: Conectar 1 rota por vez
  /api/trending    → engine.getTrending()   ← primeiro
  /api/search      → engine.searchTitles()  ← segundo
  Home/Hero        ← terceiro

Etapa 3: Title page (mais complexa)
  Manter TMDB ativo para title page enquanto engine não cobre tudo
  Ativar engine por flag por seção

Etapa 4: Desligar TMDB progressivamente
  TMDB_ACTIVE=false por rota, não globalmente
```

### Critérios para considerar a engine pronta antes de aplicar

- [ ] `scripts/test-engine.ts` retorna dados válidos para `/search?q=Breaking Bad`
- [ ] `/api/trending` retorna 20+ itens com poster e overview via Trakt
- [ ] Cache funcionando (segunda chamada = hit)
- [ ] Fallback funcionando (Trakt → local quando Trakt falha)
- [ ] TypeScript 0 erros no diretório da engine
- [ ] Nenhum arquivo fora de `src/server/poplog-engine/` importado nessa fase

---

## 5. Arquitetura da Engine (decisões já validadas)

### Contrato interno

```typescript
// Todas as fontes entregam este shape — a UI nunca sabe de onde veio
type CatalogSearchResult = {
  ids: { traktId?, traktSlug?, tvdbId?, imdbId?, tmdbId? }
  mediaType: "movie" | "show"
  title: string
  year?: number
  overview?: string
  posterUrl?: string      // URL completa (Trakt CDN) ou path TMDB legado
  backdropUrl?: string    // URL completa (Trakt fanart)
  rating?: number
  genres?: string[]
  source: { primary: "trakt"|"tvdb"|"balloonerismm"|"local", confidence, usedFallback }
}
```

### Regras de confiança Balloonerismm

```
IMDb ID confirmado → source_confidence = "high"
Sem ID cruzado    → source_confidence = "medium"
Dado instável     → source_confidence = "low" + cache obrigatório
```

### Ordem de fallback por área

```
search:   Trakt → Balloonerismm → local cache
trending: Trakt → local cache
popular:  Trakt → local cache
séries:   Trakt → TheTVDB → local cache
temporadas: TheTVDB → Trakt → local cache
episódios:  TheTVDB → Trakt → local cache
```

### Flags de ambiente

```env
TRAKT_CLIENT_ID=7eec99f3ca3e66b14515651c0a3cb76ad7703a405022e736ddbaa5a7f0dd490f
TRAKT_CLIENT_SECRET=0d546b60f9943533ce5260c12a5170b21cc64b27dc44df68adffe34449f91773
TRAKT_ACTIVE=true

TVDB_API_KEY=39b1eef4-fdb3-44e6-b9b9-27a6cd248ac4
TVDB_ACTIVE=false  ← ativar quando adapter estiver pronto

BALLOONERISMM_ACTIVE=false  ← ativar quando adapter estiver pronto
BALLOONERISMM_ALLOW_PRIMARY=false  ← nunca primeira fonte global

TMDB_ACTIVE=false
TMDB_ALLOW_IMAGE_FALLBACK=false
TMDB_ALLOW_PROVIDER_FALLBACK=false
```

---

## 6. O que NÃO fazer novamente

1. **Não editar 200 arquivos em uma branch** — migrar em fatias pequenas, uma rota por vez
2. **Não usar `cat >>` para restaurar arquivos** — usar Python com write explícito do conteúdo correto
3. **Não usar o Write tool para arquivos grandes** — usar Edit para mudanças pontuais; Write injeta null bytes
4. **Não confiar no `npx tsc` do bash Linux como validação final** — o mount pode estar com cache stale; usar o Read tool para verificar o conteúdo Windows real
5. **Não desabilitar TMDB globalmente antes de ter substituto funcionando** — cada rota individual deve ser validada antes de desligar TMDB
6. **Não criar branch longa para migração** — fazer em commits pequenos na `main` ou em branches de feature curtas (1-3 arquivos por PR)

---

## 7. Próximos passos recomendados

### Fase 1 — Engine isolada (sem tocar no app)
Criar `src/server/poplog-engine/` do zero, limpo, sem herdar nada da branch deletada. Validar com script standalone.

### Fase 2 — Primeira rota: trending
Conectar apenas `/api/trending` à engine. Manter TMDB nas demais rotas. Validar em prod.

### Fase 3 — Search
Conectar `/api/search` e `/api/poplog3/search`. Validar.

### Fase 4 — Home/Hero
Conectar `home-api.ts` à engine. Garantir backdrop + rating no search result (lição aprendida: `CatalogSearchResult` precisou de `backdropUrl` e `rating` para o filtro do Hero funcionar).

### Fase 5 — Title page (mais complexa)
A `get-title-page-data.ts` (833 linhas) tem OMDB ratings, sync jobs, providers, imagens. Migrar seção por seção com flags individuais.

### Fase 6 — TMDB off
Somente após todas as fases anteriores estarem em prod e estáveis.

---

## 8. Infraestrutura já disponível na main

- **Engine Logger** (`src/server/engine-logger/`): logging de chamadas externas, persistência em Supabase, stats, admin monitor
- **Section Cache** (`src/server/source-engine/section-cache.ts`): cache de seções com TTL
- **Supabase admin** client disponível para persistência
- **Trakt client** (`src/server/api-clients/trakt/client.ts`): funcional, testado, com JWT
- **TheTVDB client** (`src/server/api-clients/tvdb/client.ts`): criado, precisa de teste real
- **Balloonerismm client** (`src/server/api-clients/balloonerismm/client.ts`): criado, precisa de endpoint real
- **Admin panel** (`/admin`): Engine Monitor + Histórico de APIs funcionando
- **`buildTmdbRawUrl`** restaurado em `src/lib/images/url.ts` (aceita URLs completas via passthrough)
