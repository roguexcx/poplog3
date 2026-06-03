# Auth Migration Decision

Status: Fase 13B implementada com Auth.js/NextAuth + Prisma. Supabase Auth permanece como fallback temporario ate a remocao final.

## Decisao

Provider inicial de producao: Google OAuth via Auth.js.

Motivo: e o caminho mais seguro e simples para esta fase. Evita login proprio com senha, hashing, reset de senha e protecoes anti-abuso dentro do POPLOG. O provedor assume credenciais, recuperacao e controles adicionais. `local-user` continua apenas para dev/smokes.

## Opcoes avaliadas

| Opcao | Resultado |
| --- | --- |
| Manter Supabase Auth | Mantido apenas como fallback temporario |
| Local-user apenas | Mantido apenas para desenvolvimento e smokes |
| Auth.js/NextAuth + Prisma | Implementado na 13B |
| Login proprio simples | Nao recomendado nesta etapa |

## Fluxos atuais

| Fluxo | Comportamento |
| --- | --- |
| `POPLOG_LOCAL_AUTH_ENABLED=true` | `getCurrentUser()` retorna `LOCAL_USER_ID` via Prisma e ignora Auth.js/Supabase |
| Auth.js com sessao | `getCurrentUser()` usa `auth()` e retorna `authProvider: "authjs"` |
| Sem sessao Auth.js e Supabase env presente | fallback temporario via Supabase Auth |
| Sem sessao Auth.js e sem Supabase env | usuario anonimo (`null`) |

## Implementado em 13B

- Pacotes `next-auth@beta` e `@auth/prisma-adapter`.
- Modelos Prisma `Account`, `Session`, `VerificationToken` e campo `User.image`.
- Config Auth.js em `src/server/auth/auth-options.ts`.
- Rota Auth.js em `src/app/api/auth/[...nextauth]/route.ts`.
- Endpoint comum de sessao client em `src/app/api/auth/current/route.ts`.
- `getCurrentUser()` com ordem: local auth -> Auth.js -> Supabase fallback.
- `proxy.ts` com bypass local, Auth.js e fallback Supabase.
- `useAuth`, `LoginDrawer`, `Sidebar`, Profile e Home adaptados.
- Auth de `discover`, `search`, `trending` e `for-you` migrado para `getCurrentUser()`.

## Sync de usuarios Supabase

Plano sem execucao destrutiva:

1. Exportar usuarios Supabase Auth com `id`, `email`, `created_at`, metadata e providers.
2. Fazer dry-run comparando usuarios Supabase com `users` local por `id` e `email`.
3. Preservar `id` Supabase quando esse `id` ja referencia dados locais.
4. Criar/upsert em `users` com email verificado quando existir.
5. Para Google OAuth, vincular por email verificado e registrar `accounts` Auth.js.
6. Reportar conflitos antes de qualquer escrita: email duplicado, usuario sem email, id divergente, dados locais sem usuario.
7. So remover fallback Supabase depois do sync validado.

## Producao

Nao usar `local-user` em producao. Para go-live sem Supabase, usar Auth.js/NextAuth com Prisma e Google OAuth inicialmente. A remocao total do fallback Supabase fica para 13D.
