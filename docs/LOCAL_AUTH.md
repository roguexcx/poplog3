# Auth Local — Modo Dev

> **Atenção:** este modo é exclusivo para desenvolvimento local. Nunca habilitar em produção ou staging.

## O que é

`POPLOG_LOCAL_AUTH_ENABLED=true` ativa um modo de auth simplificado onde `getCurrentUser()` resolve o usuário a partir de `LOCAL_USER_ID` no banco Prisma local, sem chamar Supabase Auth.

Isso permite desenvolver e testar endpoints autenticados localmente sem precisar de cookies Supabase válidos.

## Como funciona

```
POPLOG_LOCAL_AUTH_ENABLED=true
LOCAL_USER_ID=local-user      # padrão quando não definido
```

Com a flag ligada:

1. `getCurrentUser()` em `src/server/auth/get-current-user.ts` chama `getLocalAuthUser()`.
2. `getLocalAuthUser()` lê `LOCAL_USER_ID` do env, busca no Prisma (`users` table).
3. Se o usuário não existir, cria automaticamente (mesma lógica do `db:seed`).
4. Retorna `{ id: string }` — compatível com o campo `.id` usado em todos os endpoints.

Com a flag desligada (comportamento padrão):

- `getCurrentUser()` chama Supabase `auth.getUser()` normalmente.
- Nenhuma mudança no fluxo de produção.

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `src/server/auth/get-current-user.ts` | Ponto central; branching por flag |
| `src/server/auth/local-user.ts` | Helper: resolve/cria usuário local |
| `src/server/runtime/local-db-flags.ts` | `isLocalAuthEnabled()` |
| `.env.local.example` | Variáveis documentadas |

## Limitações desta fase

- **Um único usuário**: `LOCAL_USER_ID` define um único user. Multiusuário não implementado.
- **Sem JWT / cookies**: não há token de sessão. Útil apenas em contexto server-side.
- **`proxy.ts` não está ativo como middleware**: a proteção de rotas via proxy ainda não está operacional (manifesto de middleware vazio). Endpoints individuais protegem via `if (!user) return 401`.
- **UI de login inalterada**: `LoginDrawer`, `useAuth`, `Sidebar` continuam usando Supabase Auth client-side. Não altere esses componentes nesta fase.
- **Auth.js não implementado**: esta fase não usa Auth.js nem migra para ele.

## Dependências Supabase Auth que permanecem

- `src/proxy.ts` — lógica de redirect por Supabase (inativa, preservada)
- `src/hooks/useAuth.ts` — hook client-side com `supabase.auth.onAuthStateChange`
- `src/components/auth/LoginDrawer.tsx` — UI de login Supabase
- `src/server/supabase/server.ts` — cliente server Supabase (ainda importado por endpoints não migrados)
- Endpoints que fazem `createSupabaseServerClient()` diretamente (ex: `feedback/route.ts`) continuam usando Supabase quando `POPLOG_LOCAL_FEEDBACK_ENABLED=false`

## Fora do escopo desta fase

- Login real com Auth.js
- Remoção de qualquer dependência Supabase
- Proteção de rotas via middleware
- Sessão client-side com local user

## Próxima fase sugerida

Após validar o modo local completo (`POPLOG_LOCAL_DB_ENABLED=true` + `POPLOG_LOCAL_AUTH_ENABLED=true`), a fase seguinte seria criar um middleware de proteção de rotas que respeite a flag local, permitindo navegar para `/library`, `/acompanhando` etc sem Supabase Auth.

## Smoke test

```bash
npm run db:smoke:local-auth
```

Valida: flag habilitada, resolução de `local-user`, criação automática se ausente, comportamento seguro sem `LOCAL_USER_ID`, flag desligada não quebra caminho Supabase.
