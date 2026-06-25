# POPLOG Curadoria e Indexacao - Estrutura Recomendada

Atualizado em 2026-06-25.

Este documento descreve a estrutura-alvo para o sistema de curadoria, indexacao e exibicao de filmes/series. A proposta respeita o estado atual do projeto, que usa Next.js App Router, TypeScript, Prisma, cache persistente, Redis opcional, workers locais e organizacao parcialmente feature-driven.

## Principios

- App Router fica responsavel por rotas, layouts e endpoints HTTP.
- `src/features` concentra experiencia de produto por area.
- `src/server` concentra regras de dominio, integracoes externas, cache, workers e persistencia.
- `src/lib` concentra utilitarios compartilhados puros, i18n, SEO, imagens, legal/compliance e configuracoes cross-cutting.
- APIs externas identificam/renovam dados; o POPLOG le e exibe preferencialmente banco/cache local.
- IMDb/local identity e a chave canonica de produto sempre que disponivel.

## Nova arvore de diretorios alvo

```txt
src/
  app/
    (public)/
      page.tsx
      buscar/page.tsx
      radar/page.tsx
      title/[mediaType]/[id]/page.tsx
      [slug]/page.tsx
    (account)/
      library/page.tsx
      profile/page.tsx
      settings/page.tsx
      sorteio/page.tsx
      para-voce/page.tsx
    admin/
      page.tsx
      AdminClient.tsx
      tabs/
    api/
      auth/
      search/
      radar/
      trending/
      title/
      user/
      admin/
      cron/
      og/
      storage/

  components/
    ads/
    auth/
    images/
    layout/
    skeletons/
      MediaGridSkeleton.tsx
    ui/

  features/
    home/
    search/
      SearchBar.tsx
      SearchPageView.tsx
    title/
    library/
    lists/
    radar/
    sorteio/
    for-you/
    acompanhando/
    admin/

  hooks/
    useDebouncedGlobalSearch.ts

  lib/
    ads/
    i18n/
      generated-ui-messages.json
      ui-message.ts
      locales/
        pt-BR.json
        en-US.json
    legal/
      disclaimer.ts
      consent-schema.json
      consent-storage.ts
    seo/
    images/
    personalization/

  server/
    admin/
    api-clients/
      trakt/
      balloonerismm/
      wikipedia/
      wikidata/
    availability/
    cache/
      redis-client.ts
      cache-config.ts
    catalog/
      identity/
      translations/
      assets/
      serializers/
    continuity/
    db/
    engine-logger/
    local-services/
    radar-trakt/
    repositories/
    source-engine/
    sorteio/
    streaming/
    titles/
    workers/

docs/
  architecture/
    CURATION_INDEXING_STRUCTURE.md
  legal/
    DISCLAIMER.md
```

## Arquivos adicionados nesta entrega

```txt
docs/legal/DISCLAIMER.md
docs/architecture/CURATION_INDEXING_STRUCTURE.md
src/lib/legal/disclaimer.ts
src/lib/legal/consent-schema.json
src/lib/legal/consent-storage.ts
src/hooks/useDebouncedGlobalSearch.ts
src/components/skeletons/MediaGridSkeleton.tsx
```

## Onde deve residir i18n

Estado atual correto:

```txt
src/lib/i18n/generated-ui-messages.json
src/lib/i18n/ui-message.ts
```

Direcao recomendada:

```txt
src/lib/i18n/
  generated-ui-messages.json
  ui-message.ts
  locales/
    pt-BR.json
    en-US.json
```

Regras:

- componentes nao escolhem idioma por conta propria;
- serializers e rotas devem receber `language` e `region`;
- textos visiveis de UI devem sair de componentes e passar por `uiMessage()`;
- mensagens tecnicas de API/log podem ficar fora do catalogo de interface;
- traducoes editoriais de catalogo ficam em banco (`TitleTranslation`), nao em JSON de interface.

## Onde deve residir cache local de metadados

Estado atual correto:

```txt
src/server/cache/
src/server/continuity/
src/server/source-engine/
src/server/repositories/
src/server/availability/
src/server/radar-trakt/
```

Direcao recomendada para consolidacao futura:

```txt
src/server/catalog/
  identity/
  translations/
  assets/
  serializers/
  metadata-cache/
    title-cache.service.ts
    search-cache.service.ts
    provider-cache.service.ts
    radar-cache.service.ts
```

Regras:

- cache de titulo: `title:{imdbId}:{language}:{region}`;
- cache de busca: `search:{query}:{language}:{region}`;
- cache de poster: `poster:{imdbId}:{language}`;
- cache de providers: `providers:{imdbId}:{region}:{language}`;
- cache de Radar: `radar:{mode}:{language}:{region}:{version}`;
- cache de usuario: sempre incluir `userId` quando a resposta for personalizada;
- Redis e banco persistente devem ser camadas substituiveis, nunca dependencias obrigatorias de render.

## Arquivos que devem ser deletados

Ja deletados ou marcados como remocao correta nesta rodada:

```txt
src/app/radar/RadarClient.tsx
src/server/api-clients/omdb/client.ts
src/server/api-clients/omdb/types.ts
src/server/api-clients/tvdb/client.ts
src/server/api-clients/tvdb/types.ts
src/server/normalizers/omdb-ratings.ts
```

Candidatos a deletar depois de migrar informacao util para `docs/POPLOG_V2_SYSTEM_OVERVIEW.md`:

```txt
POPLOG_FIRST_MIGRATION_STATUS.md
RADAR_STATUS_REPORT.md
RADAR_SYSTEM_REPORT.md
MAPEAMENTO-APIS-POPLOG.md
Recomendacoes-Mapeamento-Tecnico.md
```

Arquivos locais/gerados que nao devem entrar em commit:

```txt
.codex-logs/
.next/
artifacts/
storage/
*.log
```

## Arquivos que devem ser mesclados

Mesclar gradualmente:

```txt
src/app/debug/apis/*                 -> src/app/admin/tabs/TabApiHistory.tsx
src/app/debug/engine/*               -> src/app/admin/tabs/TabEngineMonitor.tsx
src/app/debug/radar/*                -> src/app/admin/tabs/TabRadarCache.tsx
src/app/api/poplog3/search/route.ts  -> src/app/api/search/route.ts, mantendo compat por redirect/adapter
src/app/api/poplog3/providers/route.ts -> src/app/api/title/[mediaType]/[id]/route.ts ou src/app/api/providers/[imdbId]/route.ts
src/server/local-services/*          -> src/server/repositories/* + services de dominio
```

Nao mesclar ainda:

```txt
src/server/radar-trakt/
src/server/availability/
src/server/source-engine/
```

Esses modulos ainda carregam regras de dominio sensiveis e devem ser estabilizados antes de uma mudanca fisica maior.

## Exemplo de uso da busca com debounce

```tsx
"use client";

import { useDebouncedGlobalSearch } from "@/hooks/useDebouncedGlobalSearch";
import { MediaGridSkeleton } from "@/components/skeletons/MediaGridSkeleton";

export function InstantSearchExample() {
  const search = useDebouncedGlobalSearch({
    language: "pt-BR",
    region: "BR",
    debounceMs: 320,
    minQueryLength: 2,
  });

  return (
    <div className="space-y-4">
      <input
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3"
      />

      {search.isLoading ? <MediaGridSkeleton items={12} /> : null}
      {!search.isLoading ? (
        <pre>{JSON.stringify(search.results.slice(0, 3), null, 2)}</pre>
      ) : null}
    </div>
  );
}
```

## Compliance e consentimento

Arquivos oficiais desta entrega:

```txt
docs/legal/DISCLAIMER.md
src/lib/legal/disclaimer.ts
src/lib/legal/consent-schema.json
src/lib/legal/consent-storage.ts
```

Persistencia recomendada:

- visitante anonimo: `localStorage` com `anonymousId`;
- usuario autenticado: banco, associado a `userId`;
- auditoria minima: versao dos termos, versao da politica, data/hora, origem do aceite, locale e categorias de cookies;
- cookies essenciais: habilitados por necessidade operacional;
- analytics, anuncios e personalizacao nao essencial: separados e desligados ate consentimento/base aplicavel.

## Ordem de refatoracao segura

1. Manter rotas publicas atuais estaveis.
2. Introduzir adapters de compatibilidade para endpoints antigos.
3. Mover UI por feature, com imports atualizados por lote.
4. Consolidar cache de metadados em `server/catalog/metadata-cache`.
5. Mover debug para Admin e remover paginas duplicadas.
6. Rodar `npm run typecheck`, `npm run audit:i18n -- --fail-on-hardcoded`, `npm run smoke:local-http` e `npm run build`.
