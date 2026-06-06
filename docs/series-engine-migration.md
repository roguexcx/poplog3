# Series Canonical Engine — Migration & Setup

## 1. Aplicar migration do banco

A migration `00000000000003_episode_external_ids_json` adiciona `external_ids_json JSON NULL` na tabela `poplog3_episodes`. Execute no ambiente local ou de deploy:

```bash
# Ambiente de desenvolvimento (aplica + regenera client)
npx prisma migrate dev

# Ambiente de produção
npx prisma migrate deploy
```

## 2. Regenerar Prisma Client

Após a migration, regenerar o client tipado:

```bash
npx prisma generate
```

O `schema.prisma` já tem `binaryTargets = ["native", "debian-openssl-3.0.x", "windows"]` para suportar geração cross-platform.

## 3. Remover cast temporário

Após o `prisma generate`, remover o cast temporário em `src/server/repositories/season-cache.repository.ts`:

```typescript
// Antes (cast temporário)
...(episode.externalIds != null ? { externalIdsJson: episode.externalIds } as Record<string, unknown> : {}),

// Depois (sem cast, Prisma Client reconhece o campo)
...(episode.externalIds != null ? { externalIdsJson: episode.externalIds as object } : {}),
```

E no `create` block:
```typescript
// Antes
...(episode.externalIds != null ? { externalIdsJson: episode.externalIds } as Record<string, unknown> : {}),

// Depois
externalIdsJson: episode.externalIds != null ? (episode.externalIds as object) : undefined,
```

## 4. Verificação pós-migration

```sql
-- Confirmar nova coluna
DESCRIBE poplog3_episodes;
-- Deve mostrar external_ids_json JSON NULL

-- Verificar se episódios com IDs externos estão sendo salvos (após abrir uma página de série)
SELECT series_tmdb_id, season_number, episode_number, external_ids_json
FROM poplog3_episodes
WHERE external_ids_json IS NOT NULL
LIMIT 10;
```

## Nota sobre tmdbPayload.canonicalMeta

O campo `Poplog3Title.tmdbPayload` está sendo usado como campo de payload canônico genérico, não como payload específico do TMDB. Ele armazena metadados ricos (`canonicalMeta`) retornados pela engine de séries:

```json
{
  "canonicalMeta": {
    "tagline": "...",
    "trailerUrl": "https://youtube.com/...",
    "homepage": "https://...",
    "logo": "https://...",
    "imagePool": ["..."],
    "network": "...",
    "networks": ["..."],
    "companies": ["..."],
    "availableTranslations": ["pt", "en", "es", ...],
    "airedEpisodes": 42,
    "ids": { "imdb": "tt...", "tvdb": 123, "trakt": 456, "slug": "..." },
    "sourceCount": 3,
    "mergeConfidence": 0.83,
    "sources": [...],
    "persistedAt": "2026-..."
  }
}
```

**Dívida técnica:** Renomear `tmdbPayload` para `canonicalPayload` ou `sourcePayload` em uma migração futura para refletir melhor que o campo não é específico do TMDB.
