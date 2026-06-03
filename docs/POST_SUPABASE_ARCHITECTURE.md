# POPLOG v3 — Arquitetura Pós-Supabase

Data: 2026-06-03

## Visão geral

O POPLOG v3 opera exclusivamente com Next.js 16, Auth.js/NextAuth, Prisma e MySQL. O Supabase foi removido integralmente. Não há fallbacks, clientes ou dependências do Supabase no código funcional.

## Camadas da aplicação

```
UI (React / App Router)
  └─ API Routes (Next.js App Router — src/app/api/*)
      └─ Services / Engines (src/server/*)
          └─ Prisma Client
              └─ MySQL
```

Não há camada de Supabase em nenhum ponto desse fluxo.

## Autenticação

| Contexto | Mecanismo |
|---|---|
| Produção | Auth.js/NextAuth com Google OAuth + `@auth/prisma-adapter` |
| Dev / smokes | `local-user` via `POPLOG_LOCAL_AUTH_ENABLED=true` |

Com `POPLOG_LOCAL_AUTH_ENABLED=true`, o middleware e `getCurrentUser()` retornam um usuário fixo (`local-user` ou o valor de `LOCAL_USER_ID`) sem passar pelo Google OAuth. Essa flag existe exclusivamente para desenvolvimento local e execução de smokes. Nunca deve ser habilitada em produção.

O arquivo de configuração principal é `src/server/auth/auth-options.ts`. Os handlers ficam em `src/app/api/auth/[...nextauth]/route.ts`.

## Banco de dados

| Ambiente | Banco |
|---|---|
| Desenvolvimento local | MySQL 8.0 via Docker (porta 3306) |
| Produção | MySQL gerenciado Hostinger |

O schema é gerenciado pelo Prisma. Migrations ficam em `prisma/migrations/`. Em desenvolvimento, `npm run db:push` aplica o schema diretamente sem migrations formais.

## Flags de feature

As flags `POPLOG_LOCAL_*` permanecem no projeto mas mudaram de propósito. Antes da remoção do Supabase, essas flags controlavam qual caminho usar — local/Prisma ou Supabase. Agora, com o Supabase removido, as flags funcionam como controles de modo de desenvolvimento:

- `POPLOG_LOCAL_AUTH_ENABLED=true` — ativa o bypass de auth para dev/smokes
- `POPLOG_LOCAL_DB_ENABLED=true` — confirma que o banco MySQL local está ativo
- Demais flags `POPLOG_LOCAL_*` — habilitam os módulos locais individualmente

Em produção, essas flags devem ficar desligadas (ou ausentes). Os módulos de produção usam Prisma diretamente, sem distinção de "modo local" vs "modo Supabase".

## Como rodar localmente

```bash
# 1. Subir MySQL via Docker
docker compose up -d

# 2. Aplicar o schema
npm run db:push

# 3. Criar o usuário local de dev
npm run db:seed

# 4. Rodar o servidor
npm run dev
```

O arquivo `.env.local` deve conter as variáveis de banco (`DATABASE_URL`), as variáveis de Auth.js (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) e as flags `POPLOG_LOCAL_*` necessárias para o modo de desenvolvimento. Ver `.env.local.full.example` para referência completa.

## Deploy em produção

Consultar `docs/DEPLOY_HOSTINGER.md` para o procedimento completo de deploy no Hostinger, incluindo configuração de variáveis de ambiente, migrations e checklist de validação.
