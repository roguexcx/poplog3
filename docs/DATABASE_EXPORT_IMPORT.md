# POPLOG v3 — Export e Import de Dados (JSON)

> Exportação e importação app-level via Prisma. Formato JSON versionado.
> Para backup/restore fiel do banco completo, use [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).

---

## Diferença: JSON export/import vs SQL backup/restore

| | JSON export/import | SQL backup/restore |
|---|---|---|
| **Formato** | JSON app-level (legível) | Dump SQL binário (mysqldump) |
| **Timestamps `@updatedAt`** | Resetados para o momento do import | Preservados exatamente |
| **Timestamps `createdAt`** | Preservados (se presentes no JSON) | Preservados exatamente |
| **Tabelas omitidas** | Logs, caches operacionais | Nenhuma (dump completo) |
| **Portabilidade** | Alta (JSON puro, fácil de inspecionar) | Depende do MySQL |
| **Uso principal** | Migração entre ambientes, seed inicial | Disaster recovery, reset completo |

---

## Formato do arquivo de export

```json
{
  "schemaVersion": "1",
  "exportedAt": "2026-06-03T10:00:00.000Z",
  "app": "poplog-v3",
  "tables": {
    "users": [ ... ],
    "user_titles": [ ... ],
    "..."
  },
  "counts": {
    "users": 1,
    "user_titles": 42,
    "..."
  }
}
```

- **`schemaVersion`**: versão do formato de export (atual: `"1"`)
- **`exportedAt`**: ISO 8601 timestamp do momento do export
- **`app`**: identificador do app (`poplog-v3`)
- **`tables`**: dados de cada tabela como array de objetos
- **`counts`**: contagem de linhas por tabela (para validação rápida)

### BigInt

Campos `BigInt` do MySQL (ex: `catalog_availability.id`, `.traktId`, `.tmdbId`) são serializados como **strings** no JSON (ex: `"12345"`) para compatibilidade com JSON standard. O import converte de volta para `BigInt` antes de enviar ao Prisma.

---

## Tabelas incluídas no export

### User data
| Tabela | Prisma Model | Descrição |
|---|---|---|
| `users` | `User` | Usuários locais |
| `user_titles` | `UserTitle` | Biblioteca do usuário |
| `user_title_state` | `UserTitleState` | Estado computado por título |
| `user_watching` | `UserWatching` | Dados de watching (acompanhando) |
| `user_episodes` | `UserEpisode` | Episódios assistidos |
| `user_ratings` | `UserRating` | Ratings pessoais |
| `user_title_feedback` | `UserTitleFeedback` | Feedback de personalização |
| `user_events` | `UserEvent` | Histórico de eventos |
| `user_curadoria_preferences` | `UserCuradoriaPreference` | Preferências de curadoria |
| `user_curadoria_signals` | `UserCuradoriaSignal` | Sinais de curadoria |
| `user_curadoria_state` | `UserCuradoriaState` | Estado da curadoria |
| `hero_spotlight_sessions` | `HeroSpotlightSession` | Impressões do hero |

### Catálogo
| Tabela | Prisma Model | Descrição |
|---|---|---|
| `poplog3_titles` | `Poplog3Title` | Títulos do catálogo |
| `poplog3_episodes` | `Poplog3Episode` | Episódios |
| `title_seasons` | `TitleSeason` | Temporadas |
| `title_external_ids` | `TitleExternalId` | IDs externos (IMDB, TVDB...) |
| `title_ratings` | `TitleRating` | Ratings do catálogo (IMDB, RT...) |
| `catalog_availability` | `CatalogAvailability` | Disponibilidade por provedor |

### Caches
| Tabela | Prisma Model | Descrição |
|---|---|---|
| `continuity_section_cache` | `ContinuitySectionCache` | Cache das seções de continuidade |
| `ics_agenda_cache` | `IcsAgendaCache` | Cache da agenda ICS |

---

## Tabelas omitidas e motivo

| Tabela | Motivo |
|---|---|
| `engine_api_call_logs` | Logs operacionais; podem ser re-gerados |
| `api_usage_daily` | Logs de uso de API; re-populados automaticamente |
| `poplog3_premium_api_usage` | Rastreamento de API premium; não é dado do usuário |
| `poplog3_title_availability` | Cache operacional; re-populado ao usar o app |
| `poplog3_availability_fallback_state` | Estado de fallback; re-populado automaticamente |
| `streaming_providers` | Tabela de referência pequena; não tem dados do usuário |
| `rating_aggregates` | Calculado a partir de `user_ratings`; pode ser regenerado |
| `search_cache` | Não existe no schema Prisma local (é Supabase-only) |

---

## Como exportar

```bash
npm run db:export
```

Gera: `exports/poplog-export-YYYY-MM-DD-HH-mm.json`

O arquivo é criado automaticamente na pasta `exports/`. Pode ser aberto em qualquer editor de texto.

---

## Como importar

### Modo seguro (padrão — sem destruir dados existentes)

```bash
npm run db:import
```

Usa o export mais recente em `exports/`. Equivalente a `createMany` com `skipDuplicates=true`: apenas adiciona registros novos, não modifica os existentes.

```bash
# Especificar arquivo manualmente
npm run db:import -- --file exports/poplog-export-2026-06-03-10-00.json
```

### Modo dry-run (simular sem gravar)

```bash
npm run db:import -- --dry-run
npm run db:import -- --dry-run --file exports/poplog-export-...json
```

### Modo replace (DESTRUTIVO — apaga tudo e reimporta)

```bash
npm run db:import -- --replace --yes
npm run db:import -- --replace --yes --file exports/poplog-export-...json
```

**Atenção**: apaga todos os dados nas tabelas exportadas antes de reimportar. Exige `--yes`. Não apaga tabelas omitidas do export (logs, etc.).

---

## Limitação conhecida: `@updatedAt`

O Prisma atualiza automaticamente campos anotados com `@updatedAt` em qualquer operação de escrita. Por isso, ao importar via `db:import`, os campos `updatedAt` de todos os registros serão definidos para o momento do import, não para o valor original.

Para preservar os timestamps exatos, use `db:restore` (SQL dump).

---

## Smoke test

```bash
npm run db:smoke:export-import
```

Valida: export funciona, JSON tem formato correto, dry-run funciona, import seguro funciona, proteção de --replace sem --yes funciona.

---

## Pasta `exports/`

A pasta `exports/` está no `.gitignore` — os arquivos não são versionados. Faça backup manual dos exports importantes em local seguro.
