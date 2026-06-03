# Auth.js Setup

Status: Fase 13B. Auth.js/NextAuth foi adicionado como caminho real de auth com Prisma.

## Provider

Provider inicial: Google OAuth.

Callback local:

```text
http://localhost:3000/api/auth/callback/google
```

Callback producao:

```text
https://seu-dominio.com/api/auth/callback/google
```

## Pacotes

```bash
npm install next-auth@beta @auth/prisma-adapter
```

Versoes instaladas:

- `next-auth@5.0.0-beta.31`
- `@auth/prisma-adapter@2.11.2`

## Envs

```bash
AUTH_SECRET=
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

Gere `AUTH_SECRET` com:

```bash
npx auth secret
```

## Prisma

Modelos adicionados:

- `Account`
- `Session`
- `VerificationToken`
- `User.image`

Migration incremental:

```text
prisma/migrations/00000000000001_authjs/migration.sql
```

## Arquitetura

- `src/server/auth/auth-options.ts`: provider Google, Prisma adapter, estrategia de sessao database.
- `src/server/auth/next-auth.ts`: exporta `handlers`, `auth`, `signIn`, `signOut`.
- `src/app/api/auth/[...nextauth]/route.ts`: rotas Auth.js.
- `src/app/api/auth/current/route.ts`: endpoint leve para client auth.
- `src/hooks/useAuth.ts`: le `/api/auth/current`.

## Fallback temporario

Supabase Auth ainda existe para:

- formulario antigo no `LoginDrawer`;
- sign-out fallback em `Sidebar` e Profile quando `authProvider === "supabase"`;
- rotas que ainda chamam `createSupabaseServerClient().auth.getUser()` diretamente.

Remover apenas na 13D.
