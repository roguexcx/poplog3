# Auth Migration Decision

Status: Concluido na Fase 13D. Auth.js/NextAuth + Prisma e o sistema de auth definitivo. Supabase Auth foi removido completamente em 2026-06-03.

## Decisao final

Provider de producao: Google OAuth via Auth.js com Prisma adapter.

Motivo: e o caminho mais seguro e simples para esta aplicacao. Evita login proprio com senha, hashing, reset de senha e protecoes anti-abuso dentro do POPLOG. O provedor Google assume credenciais, recuperacao e controles adicionais. `local-user` continua apenas para dev/smokes.

O Supabase Auth era o sistema anterior e foi substituido integralmente pelo Auth.js na Fase 13B, com remocao completa do fallback na Fase 13D.

## Opcoes avaliadas

| Opcao | Resultado |
| --- | --- |
| Manter Supabase Auth | Descartado — Supabase removido na Fase 13D |
| Local-user apenas | Mantido apenas para desenvolvimento e smokes |
| Auth.js/NextAuth + Prisma | Implementado na 13B; sistema definitivo desde 13D |
| Login proprio simples | Nao recomendado nesta etapa |

## Fluxos atuais

| Fluxo | Comportamento |
| --- | --- |
| `POPLOG_LOCAL_AUTH_ENABLED=true` | `getCurrentUser()` retorna `LOCAL_USER_ID` via Prisma; ignorado em producao |
| Auth.js com sessao | `getCurrentUser()` usa `auth()` e retorna `authProvider: "authjs"` |
| Sem sessao Auth.js | usuario anonimo (`null`) |

## Implementado em 13B

- Pacotes `next-auth@beta` e `@auth/prisma-adapter`.
- Modelos Prisma `Account`, `Session`, `VerificationToken` e campo `User.image`.
- Config Auth.js em `src/server/auth/auth-options.ts`.
- Rota Auth.js em `src/app/api/auth/[...nextauth]/route.ts`.
- Endpoint comum de sessao client em `src/app/api/auth/current/route.ts`.
- `getCurrentUser()` com ordem: local auth -> Auth.js.
- `proxy.ts` com bypass local e Auth.js.
- `useAuth`, `LoginDrawer`, `Sidebar`, Profile e Home adaptados.
- Auth de `discover`, `search`, `trending` e `for-you` migrado para `getCurrentUser()`.

## Removido em 13D

- Fallback Supabase em `getCurrentUser()` eliminado.
- `server/supabase/server.ts` e `server/supabase/admin.ts` removidos.
- `lib/supabase/client.ts` e `lib/supabase/server.ts` removidos.
- Pacotes `@supabase/supabase-js` e `@supabase/ssr` removidos do `package.json`.
- Variaveis de ambiente Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) descontinuadas.

## Sync de usuarios

Usuarios que existiam no Supabase Auth foram migrados para a tabela `users` do MySQL local, vinculando por email verificado e registrando `accounts` Auth.js para o provedor Google. O processo foi:

1. Export de usuarios Supabase Auth com `id`, `email`, `created_at`, metadata e providers.
2. Dry-run comparando usuarios Supabase com `users` local por `id` e `email`.
3. Preservacao de `id` quando esse `id` ja referenciava dados locais.
4. Upsert em `users` com email verificado.
5. Vinculacao por email verificado e registro em `accounts` Auth.js.

## Producao

Em producao, usar Auth.js/NextAuth com Prisma e Google OAuth. Nao definir `POPLOG_LOCAL_AUTH_ENABLED=true` nem `LOCAL_USER_ID`. As variaveis obrigatorias sao `AUTH_SECRET`, `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET`.
