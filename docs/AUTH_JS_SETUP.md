# Auth.js Setup

Status: Fase 13D. Auth.js/NextAuth e o sistema de auth definitivo em producao. Supabase Auth foi removido completamente.

## Provider

Provider de producao: Google OAuth.

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

### Producao (obrigatorio)

```bash
AUTH_SECRET=          # gere com: npx auth secret
AUTH_GOOGLE_ID=       # Client ID do Google Cloud Console
AUTH_GOOGLE_SECRET=   # Client Secret do Google Cloud Console
# AUTH_URL=https://seu-dominio.com   # necessario em alguns provedores
```

### Desenvolvimento local

```bash
AUTH_SECRET=qualquer-valor-local
AUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
AUTH_GOOGLE_ID=      # necessario apenas se testar login Google localmente
AUTH_GOOGLE_SECRET=
```

Em desenvolvimento local, o modo mais simples e usar `POPLOG_LOCAL_AUTH_ENABLED=true` com `LOCAL_USER_ID=local-user`, sem precisar configurar Google OAuth.

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

## Fluxo de autenticacao

1. Usuario clica em "Entrar" no `LoginDrawer`.
2. Auth.js redireciona para o consentimento Google OAuth.
3. Google retorna o codigo de autorizacao para `/api/auth/callback/google`.
4. Auth.js troca o codigo por tokens, cria/atualiza registros em `Account` e `User` no MySQL via Prisma.
5. Uma sessao e criada na tabela `Session` e um cookie assinado com `AUTH_SECRET` e retornado ao browser.
6. `getCurrentUser()` server-side usa `auth()` para ler a sessao e retornar o usuario.
7. Client-side, `useAuth` consome `/api/auth/current` para obter o estado da sessao.

## Configurar Google OAuth

1. Acesse o Google Cloud Console (https://console.cloud.google.com).
2. Crie ou selecione um projeto.
3. Va em APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID.
4. Tipo: Web application.
5. Adicione as origens autorizadas:
   - `http://localhost:3000` (desenvolvimento)
   - `https://seu-dominio.com` (producao)
6. Adicione os callbacks autorizados:
   - `http://localhost:3000/api/auth/callback/google` (desenvolvimento)
   - `https://seu-dominio.com/api/auth/callback/google` (producao)
7. Copie o Client ID para `AUTH_GOOGLE_ID` e o Client Secret para `AUTH_GOOGLE_SECRET`.

## Modo local sem Google OAuth

Para desenvolvimento sem configurar Google OAuth:

```env
POPLOG_LOCAL_AUTH_ENABLED=true
LOCAL_USER_ID=local-user
```

Neste modo, `getCurrentUser()` retorna diretamente o usuario `local-user` do MySQL sem passar pelo Auth.js. Nao requer `AUTH_GOOGLE_ID` nem `AUTH_GOOGLE_SECRET`.
