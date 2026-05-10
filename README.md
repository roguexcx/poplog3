# POPLOG v2

Plataforma de curadoria pessoal de filmes e séries, construída com **Next.js (App Router)**, integração com **TMDB** e dados de usuário em **Supabase**.

> Objetivo do POPLOG: combinar catálogo global (TMDB) com inteligência de produto própria (watchlist viva, sugestões, status de streaming, sorteio e progressos pessoais).

---

## Visão geral da arquitetura

O sistema separa claramente duas camadas de domínio:

1. **Conteúdo TMDB (catálogo público)**
   - metadados de títulos, listas, detalhes, imagens, temporadas, episódios e provedores.
   - acesso centralizado via `tmdbFetch` em `src/lib/tmdb.ts`.

2. **Inteligência POPLOG (camada proprietária)**
   - estados do usuário (`watchlist`, `watched`, `watching`, `fridge`, `favorite`, etc.).
   - heurísticas de relevância e recomendações.
   - enriquecimento para UX (labels, textos contextuais, disponibilidade "viva", ações e filtros).

Essa separação evita acoplamento indevido entre dado bruto do TMDB e decisões de produto do POPLOG.

---

## Stack técnica

- **Framework:** Next.js 16 (App Router)
- **UI:** React 19 + Tailwind CSS 4
- **Auth e Banco:** Supabase (`@supabase/supabase-js` + `@supabase/ssr`)
- **Linguagem:** TypeScript (modo `strict`)
- **Lint:** ESLint + `eslint-config-next`

---

## Estrutura de pastas

```text
src/
  app/                    # Rotas App Router (páginas e APIs internas)
    api/                  # Endpoints server-side (BFF do frontend)
      tmdb/               # Proxy/list/discover/detail para TMDB
      user/               # Enriquecimento de dados de títulos do usuário
      watchlist/live/     # Watchlist "viva" com status de streaming
      search/ episodes/ ...
    filmes/ series/ buscar/ profile/ settings/ title/[type]/[id]/ ...

  features/               # Organização por domínio de tela/feature
    home/
    title/
    search/
    sorteio/

  components/             # Componentes reaproveitáveis (layout, UI, cartões etc.)
  hooks/                  # Hooks de autenticação, toggles e consulta
  context/                # Contextos globais (ex.: UserData)
  lib/                    # Serviços, utilitários e normalizadores
    supabase/
    tmdb.ts
    streaming.ts
    relevance-score.ts
    domain-labels.ts      # Fonte única de labels/traduções/formatadores

  types/
    user.ts
    tmdb.ts
    api-contracts.ts      # Contratos compartilhados entre APIs e frontend
```

---

## Principais features

### Home
- Hero com destaque dinâmico e seções personalizadas.
- Trilhos de descoberta (trending, recomendações e cortes por estado do usuário).

### Página de título (`/title/[type]/[id]`)
- Detalhes completos TMDB + elenco, trailer, temporadas/episódios, similares.
- Ações de usuário (watchlist, watched, favoritos etc.).
- Blocos de disponibilidade e contexto de consumo.

### Buscar (`/buscar`)
- Busca textual + atalhos por categorias/descoberta.
- Orquestra resultados de múltiplas rotas internas.

### Profile
- Biblioteca pessoal com filtros, abas e sugestões.
- Combina metadados TMDB com status/progresso local do usuário.

### Sorteio
- Modo de descoberta guiado por filtros de vibe, duração, disponibilidade e origem.
- Combina acervo pessoal + catálogo para desempate de escolha.

---

## Fluxo de dados

1. **UI/Feature** dispara ação (server render ou client fetch).
2. **API interna (`src/app/api`)** faz agregação e normalização para o frontend.
3. **Serviços de domínio em `lib/`** aplicam regras de negócio (streaming, relevância, labels).
4. **TMDB** fornece catálogo base.
5. **Supabase** persiste preferências e estados de usuário.

### Exemplo prático (watchlist viva)
- Front envia títulos salvos para `/api/watchlist/live`.
- Rota consulta detalhes TMDB, cruza com heurísticas de `streaming.ts`.
- Retorna payload enriquecido com `stream_status`, `providers`, `context_pool`, `runtime_label`.

---

## APIs internas (BFF)

- `POST /api/user/titles`
  - Enriquecimento base dos títulos do usuário com payload TMDB.
  - Contratos tipados em `src/types/api-contracts.ts`.

- `POST /api/watchlist/live`
  - Enriquecimento avançado da watchlist para disponibilidade atual.
  - Normalização de gênero/runtime e contexto de streaming.

- `GET /api/tmdb/list`, `GET /api/tmdb/discover`, `GET /api/tmdb/[type]/[id]`
  - Rotas de catálogo e descoberta.

- `GET /api/search`
  - Busca agregada para filmes/séries.

---

## Normalizadores e contratos compartilhados

Atualização recente importante:

- `src/lib/domain-labels.ts` agora centraliza:
  - `GENRE_LABEL_BY_ID`
  - `GENRE_TRANSLATION_BY_NAME`
  - `getContentTypeLabel`
  - `formatRuntimeLabel`
  - `parseYearLabel`
  - `translateGenreName`

- `src/types/api-contracts.ts` centraliza contratos das rotas de enriquecimento
  para reduzir divergências de shape entre API, serviço e componente.

Esses arquivos são a **fonte de verdade** para labels/traduções/contratos.

---

## Convenções de TypeScript e código

### TypeScript
- `strict: true` (evitar `any` implícito).
- Tipos de domínio em `src/types/*`.
- Contratos de API compartilhados em `src/types/api-contracts.ts`.
- Preferir funções puras para normalização e formatação.

### Componentes
- **Server Components** por padrão quando não há interação.
- **Client Components** apenas quando necessário (`"use client"`), para estado local, eventos e efeitos.
- Componentes muito grandes devem ser quebrados por responsabilidade (UI, estado, regras).

### Hooks
- Hooks em `src/hooks` devem encapsular comportamento reutilizável.
- Evitar duplicar fontes de verdade para os mesmos dados.
- Efeitos devem sincronizar sistemas externos; derivação de estado deve priorizar `useMemo`/funções puras.

### Serviços e domínio
- Regras de negócio em `src/lib` (não em JSX de tela, quando possível).
- Acesso TMDB centralizado em `tmdbFetch`.
- Heurísticas de disponibilidade em `streaming.ts`.
- Score/sugestão em `relevance-score.ts`.

### Estilo
- Tailwind utilitário, mantendo padrões visuais consistentes por feature.
- Componentes base reutilizáveis em `src/components/ui` quando possível.

---

## Variáveis de ambiente esperadas

Defina no `.env.local`:

```bash
TMDB_API_KEY=...
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

> Em produção, `NEXT_PUBLIC_BASE_URL` deve apontar para o host público da aplicação.

---

## Comandos de desenvolvimento

```bash
npm install
npm run dev       # ambiente local
npm run lint      # verificação estática
npm run build     # build de produção
npm run start     # sobe build local
```

---

## Decisões arquiteturais importantes

1. **BFF via App Router API routes**
   - O frontend não fala com TMDB diretamente; passa pelas APIs internas quando precisa de agregação.

2. **Separação TMDB vs Inteligência POPLOG**
   - TMDB entrega fato bruto de catálogo.
   - POPLOG decide semântica de produto (priorização, contexto, disponibilidade e experiência pessoal).

3. **Normalização centralizada**
   - Labels, traduções e contratos compartilhados evitam drift de comportamento entre telas.

4. **Evolução orientada a domínio**
   - Features em `src/features/*`; regras comuns em `src/lib/*`; contratos em `src/types/*`.

---

## Próximos passos recomendados

- Continuar removendo duplicações legadas em componentes extensos.
- Expandir cobertura de testes para normalizadores e APIs internas.
- Criar documentação de migração para contratos de API em futuras mudanças de payload.

