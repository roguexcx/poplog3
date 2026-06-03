# Supabase — Legado

Este diretório contém artefatos históricos da infraestrutura Supabase que o POPLOG v3 usou antes da migração para MySQL/Prisma.

**Status: REMOVIDO em 2026-06-03 (branch codex/loca-db, Fase 13D+13E)**

## O que está aqui

- `migrations/` — SQL migrations que definiram o schema Supabase (PostgreSQL). Mantidas como referência histórica.
- `functions/` — Edge Functions Supabase que foram substituídas por serviços Prisma locais.
- `seed.sql` — Seed inicial Supabase.

## Por que foi removido

- Custo de egress Supabase Free Tier
- Complexidade de manter dois caminhos de dados (Supabase + Prisma)
- Produção migrará para Hostinger MySQL gerenciado
- Auth.js/NextAuth é o caminho real de autenticação (Google OAuth)

## Caminho atual

- **Auth:** Auth.js/NextAuth + Prisma adapter (Google OAuth em produção; `local-user` para dev/smokes)
- **DB:** MySQL local via Docker (dev), MySQL gerenciado Hostinger (produção)
- **ORM:** Prisma 6.x
- **Schema:** `prisma/schema.prisma`
- **Migrations:** `prisma/migrations/` (ou `npx prisma db push` para push direto)

## Como consultar o histórico

```
git log --oneline -- supabase/
git show <commit>:supabase/migrations/001_create_user_watching.sql
```

Os arquivos deste diretório podem ser removidos a qualquer momento sem impacto no app.
