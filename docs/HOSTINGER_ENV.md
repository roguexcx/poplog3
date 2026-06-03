# POPLOG v3 — Variáveis de Ambiente (Produção Hostinger)

> Referência completa de variáveis de ambiente para deploy no Hostinger.
> **Nunca commitar valores reais.** Use placeholders e preencha no servidor.
>
> Para o ambiente local de desenvolvimento, ver `.env.local.full.example`.

---

## Template de produção

Salvar como `.env` (ou configurar via painel da VPS) com os valores reais:

```env
# ═══════════════════════════════════════════════════════════
# POPLOG v3 — .env de produção (Hostinger)
# Fase 12: MySQL local ativo + Supabase Auth preservado
# ═══════════════════════════════════════════════════════════

# ── Node ─────────────────────────────────────────────────
NODE_ENV=production

# ── Banco MySQL (Hostinger) ───────────────────────────────
DATABASE_URL="mysql://HOSTINGER_DB_USER:HOSTINGER_DB_PASS@HOSTINGER_DB_HOST:3306/HOSTINGER_DB_NAME"

# ── Módulos locais: tudo ativo em produção ────────────────
# Master switch: ativa logs, caches e todos os sub-módulos.
POPLOG_LOCAL_DB_ENABLED=true

# ── Auth ──────────────────────────────────────────────────
# DESLIGADA em produção. Supabase Auth é usado para login real.
# Só ligar em dev local com LOCAL_USER_ID.
POPLOG_LOCAL_AUTH_ENABLED=false

# ── Supabase Auth (necessário até Fase 13) ────────────────
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.PLACEHOLDER
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.PLACEHOLDER

# ── APIs externas ─────────────────────────────────────────
TMDB_API_KEY=SUA_CHAVE_TMDB
OMDB_API_KEY=SUA_CHAVE_OMDB
WATCHMODE_API_KEY=SUA_CHAVE_WATCHMODE
# MOTN_API_KEY=SUA_CHAVE_MOTN        # se usar Movie of the Night
# TRAKT_API_KEY=SUA_CHAVE_TRAKT      # se usar Trakt

# ── Flags individuais (redundantes com POPLOG_LOCAL_DB_ENABLED=true) ──
# Não é necessário setar quando POPLOG_LOCAL_DB_ENABLED=true.
# Listadas aqui apenas para referência e override pontual.
#
# POPLOG_LOCAL_LOGS_ENABLED=true
# POPLOG_LOCAL_CACHE_ENABLED=true
# POPLOG_LOCAL_API_USAGE_ENABLED=true
# POPLOG_LOCAL_AVAILABILITY_ENABLED=true
# POPLOG_LOCAL_LIBRARY_ENABLED=true
# POPLOG_LOCAL_USER_STATE_ENABLED=true
# POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED=true
# POPLOG_LOCAL_USER_RATINGS_ENABLED=true
# POPLOG_LOCAL_FEEDBACK_ENABLED=true
# POPLOG_LOCAL_USER_PREFERENCES_ENABLED=true
# POPLOG_LOCAL_CURADORIA_ENABLED=true
# POPLOG_LOCAL_CURADORIA_STATE_ENABLED=true
# POPLOG_LOCAL_ACOMPANHANDO_ENABLED=true
# POPLOG_LOCAL_HERO_ENABLED=true
# POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED=true
# POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED=true
# POPLOG_LOCAL_NEW_EPISODES_ENABLED=true
# POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED=true
# POPLOG_LOCAL_RADAR_ENABLED=true
# POPLOG_LOCAL_AGENDA_ENABLED=true
```

---

## Referência de cada variável

### `NODE_ENV`
| | |
|---|---|
| Produção | `production` |
| Dev local | `development` (Next.js default) |

Afeta: otimizações de build Next.js, mensagens de erro, modo de hot-reload.

---

### `DATABASE_URL`
| | |
|---|---|
| Formato | `mysql://USER:PASS@HOST:PORT/DATABASE` |
| Produção (Hostinger) | `mysql://poplog_user:senha@mysql.hostinger.com:3306/poplog_v3_prod` |
| Dev local (Docker) | `mysql://poplog:poplog_local_password@localhost:3306/poplog_v3` |

**Como obter no Hostinger:**
1. hPanel → Databases → MySQL Databases
2. Crie banco + usuário
3. Connection details: host, porta (geralmente 3306), user, password, dbname

**Pool de conexões (opcional):**
Adicione `?connection_limit=5` ao final para limitar conexões em planos com restrição:
```env
DATABASE_URL="mysql://user:pass@host:3306/db?connection_limit=5"
```

---

### `POPLOG_LOCAL_DB_ENABLED`
| | |
|---|---|
| Produção | `true` |
| Dev (flags off) | `false` |

Master switch. Quando `true`, ativa todos os sub-módulos locais sem precisar setar cada flag individualmente. O código em `src/server/runtime/local-db-flags.ts` propaga este valor.

---

### `POPLOG_LOCAL_AUTH_ENABLED`
| | |
|---|---|
| Produção | **`false`** (obrigatório) |
| Dev local | `true` (usado com `LOCAL_USER_ID`) |

**Nunca setar `true` em produção.** Isso elimina qualquer verificação de identidade real e permite acesso com qualquer valor de `LOCAL_USER_ID`.

Em produção, a autenticação passa pelo Supabase Auth (ver abaixo).

---

### `LOCAL_USER_ID`
| | |
|---|---|
| Produção | **Não usar / não definir** |
| Dev local | `local-user` (ou ID do usuário de teste) |

Apenas relevante quando `POPLOG_LOCAL_AUTH_ENABLED=true`. Ignorado em produção.

---

### `NEXT_PUBLIC_SUPABASE_URL`
| | |
|---|---|
| Valor | URL do projeto Supabase (ex: `https://abcxyz.supabase.co`) |
| Onde obter | Supabase Dashboard → Project Settings → API |

Necessário até Fase 13. Exposto ao cliente (prefixo `NEXT_PUBLIC_`).

---

### `NEXT_PUBLIC_SUPABASE_ANON_KEY`
| | |
|---|---|
| Valor | JWT anon key do projeto Supabase |
| Onde obter | Supabase Dashboard → Project Settings → API → `anon` `public` |

Necessário até Fase 13. Exposto ao cliente.

---

### `SUPABASE_SERVICE_ROLE_KEY`
| | |
|---|---|
| Valor | JWT service role key (acesso admin sem RLS) |
| Onde obter | Supabase Dashboard → Project Settings → API → `service_role` |

**Nunca expor no cliente.** Usado apenas server-side para operações admin.
Necessário até Fase 13.

---

### `TMDB_API_KEY`
| | |
|---|---|
| Valor | Chave de API do The Movie Database |
| Onde obter | https://www.themoviedb.org/settings/api |
| Tier necessário | Free (sufficient para uso normal) |

Obrigatório para enriquecimento de catálogo (fetch de títulos, episódios, temporadas).

---

### `OMDB_API_KEY`
| | |
|---|---|
| Valor | Chave de API do OMDB |
| Onde obter | https://www.omdbapi.com/apikey.aspx |
| Tier necessário | Free (1.000 req/dia) ou Patron (100k req/dia) |

Usado para ratings IMDB e dados complementares.

---

### `WATCHMODE_API_KEY`
| | |
|---|---|
| Valor | Chave de API do Watchmode |
| Onde obter | https://api.watchmode.com/ |

Usado para dados de disponibilidade em streamings.

---

## Prisma em produção

### Situação atual (Fase 12)

O projeto usa `prisma db push` — sem histórico de migrations (`prisma/migrations/` não existe).

`db push` aplica o schema atual diretamente no banco, sem registro de versões. É adequado para desenvolvimento, mas tem riscos em produção:

- Não mantém histórico de alterações de schema
- `db push` pode apagar dados em certas mudanças destrutivas (ex: renomear coluna)
- Não permite rollback de schema

### Caminho recomendado antes do go-live

```bash
# 1. No ambiente local, com banco limpo (após prisma migrate reset):
npx prisma migrate dev --name init

# 2. Isso cria prisma/migrations/TIMESTAMP_init/migration.sql
# 3. Commitar a pasta prisma/migrations/

# 4. Em produção, usar:
npx prisma migrate deploy
```

### Enquanto não houver migrations

Use `db push` em produção, com cuidado redobrado ao alterar o schema:

```bash
# Aplicar schema no banco Hostinger
DATABASE_URL="mysql://..." npx prisma db push

# OU com .env já configurado:
npx prisma db push
```

**Antes de cada `db push` em produção**: faça um backup SQL primeiro.

```bash
npm run db:backup   # local
# ou via phpMyAdmin do Hostinger
```

---

## Variáveis que NÃO vão para produção

| Variável | Motivo |
|---|---|
| `LOCAL_USER_ID` | Exclusivo do modo dev local |
| `MYSQL_DOCKER_CONTAINER` | Específico do Docker local |
| Flags `POPLOG_LOCAL_*` individuais | Redundantes com `POPLOG_LOCAL_DB_ENABLED=true` |

---

## Exemplo de `.env` mínimo de produção

```env
NODE_ENV=production
DATABASE_URL="mysql://poplog_prod:SENHA@mysql.hostinger.host:3306/poplog_v3"
POPLOG_LOCAL_DB_ENABLED=true
POPLOG_LOCAL_AUTH_ENABLED=false
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
TMDB_API_KEY=...
OMDB_API_KEY=...
WATCHMODE_API_KEY=...
```
