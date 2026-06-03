# Supabase Removal Audit

Status: Fase 13B. Auth.js/NextAuth + Prisma foi adicionado como caminho real de auth. Supabase permanece instalado e funcional como fallback/legado.

## Resumo

| Grupo | Status | Acao |
| --- | --- | --- |
| Auth | Parcialmente migrado | Auth.js ativo; Supabase Auth fallback temporario |
| Rotas de usuario | Parcial | `for-you` auth migrado; `streaming-preferences`, `feedback`, `not-interested`, `watchlist/live` ficam para 13C |
| Rotas publicas | Parcial | `discover`, `search`, `trending` autenticam via `getCurrentUser()` |
| Admin/debug/backfill | Manter temporario | Migrar/remover em 13C/13D |
| Engines/background jobs | Parcial | `sorteio`, `agenda-engine`, caches e `rating_aggregates` ficam para 13C |
| Fallback removivel | 13D | Remover deps, wrappers, envs e functions/migrations Supabase legadas |

## Migrado na 13A

| Arquivo | Status |
| --- | --- |
| `src/app/api/poplog3/continuity/upcoming-episodes/route.ts` | Caminho Prisma local com fallback Supabase |
| `src/app/api/user/genre-stats/route.ts` | Caminho Prisma local com fallback Supabase |
| `prisma/migrations/00000000000000_init/migration.sql` | Baseline Prisma inicial |

## Migrado na 13B

| Arquivo | Tipo | Status | Risco |
| --- | --- | --- | --- |
| `package.json`, `package-lock.json` | deps Auth.js | `next-auth@beta`, `@auth/prisma-adapter` adicionados | Medio |
| `prisma/schema.prisma` | modelos Auth.js | `Account`, `Session`, `VerificationToken`, `User.image` | Medio |
| `prisma/migrations/00000000000001_authjs/migration.sql` | migration | Auth.js incremental | Medio |
| `src/server/auth/auth-options.ts` | config | Google OAuth + Prisma adapter | Baixo |
| `src/server/auth/next-auth.ts` | helper | `handlers`, `auth`, `signIn`, `signOut` | Baixo |
| `src/app/api/auth/[...nextauth]/route.ts` | route | Auth.js App Router | Baixo |
| `src/app/api/auth/current/route.ts` | route | Sessao client por `getCurrentUser()` | Baixo |
| `src/server/auth/get-current-user.ts` | auth server | local -> Auth.js -> Supabase fallback | Medio |
| `src/proxy.ts` | proxy | local bypass, Auth.js, fallback Supabase | Medio |
| `src/hooks/useAuth.ts` | client auth | Remove Supabase direto do hook | Baixo |
| `src/components/auth/LoginDrawer.tsx` | UI auth | Google OAuth primario; Supabase form fallback | Medio |
| `src/components/layout/Sidebar.tsx` | UI auth | Usa `useAuth`; Auth.js signOut; fallback Supabase signOut | Medio |
| `src/app/profile/ProfilePageClient.tsx` | UI auth | Usa `useAuth`; stats via `/api/library`; fallback Supabase signOut | Medio |
| `src/features/home/HomePage.tsx` | server auth | Usa `getCurrentUser()` | Baixo |
| `src/features/home/HomeMemberSections.tsx` | types | Usa `AuthUser` | Baixo |
| `src/context/UserDataContext.tsx` | client data | Usa `/api/library` em vez de Supabase client | Medio |
| `src/app/api/discover/route.ts` | route auth | Usa `getCurrentUser()` | Baixo |
| `src/app/api/search/route.ts` | route auth | Usa `getCurrentUser()` | Baixo |
| `src/app/api/trending/route.ts` | route auth | Usa `getCurrentUser()`; cache/dados Supabase ainda ficam | Medio |
| `src/app/api/user/for-you/route.ts` | route auth | Usa `getCurrentUser()`; dados Supabase ainda ficam | Medio |

## Ainda depende de Supabase Auth

| Arquivo | Motivo | Fase |
| --- | --- | --- |
| `src/app/api/user/streaming-preferences/route.ts` | Auth + tabelas `streaming_providers`/`user_streaming_preferences` Supabase | 13C |
| `src/server/streaming/user-provider-preferences.ts` | Auth + preferencias streaming Supabase | 13C |
| `src/app/api/user/feedback/route.ts` | Auth + writes fallback Supabase | 13C |
| `src/app/api/user/feedback/batch/route.ts` | Auth + feedback fallback Supabase | 13C |
| `src/app/api/user/not-interested/route.ts` | Auth + feedback/title cache Supabase | 13C |
| `src/app/api/watchlist/live/route.ts` | Auth + watchlist/hydrate Supabase | 13C |
| `src/lib/personalization/feedback.ts` | Cria client Supabase quando feedback local esta OFF | 13D |
| `src/components/auth/LoginDrawer.tsx` | Formulario Supabase fallback | 13D |
| `src/components/layout/Sidebar.tsx` | Sign-out Supabase fallback | 13D |
| `src/app/profile/ProfilePageClient.tsx` | Sign-out Supabase fallback | 13D |

## Ainda depende de Supabase dados/admin

| Grupo | Exemplos | Fase |
| --- | --- | --- |
| Admin/debug/backfill/hydrate | `admin/backfill-title-state`, `hydrate-library`, `hydrate-series-episodes`, `watchlist-hydrate`, `debug/supabase` | 13C/13D |
| Continuidade fallback | `continue`, `recently-watched`, `new-episodes`, `watchlist-picks`, `acompanhando` fallback | 13D apos paridade |
| Engines | `sorteio-engine`, `agenda-engine`, `rating-aggregate-service`, `fuzzy-title-search`, runtime/caches | 13C |
| Wrappers | `src/server/supabase/*`, `src/lib/supabase/*` | 13D |
| Pacotes/envs | `@supabase/supabase-js`, `@supabase/ssr`, envs Supabase | 13D |
| Supabase legado | `supabase/migrations/*`, `supabase/functions/*` | 13D |

## Prisma migrations

`00000000000000_init` continua como baseline. `00000000000001_authjs` adiciona Auth.js. Como o banco local historico foi mantido por `db push`, validar ambiente real com:

1. banco vazio: `prisma migrate deploy`;
2. banco existente equivalente: diff limpo antes de `migrate resolve`;
3. local atual: `npm run db:push`.

## Proximas fases

| Fase | Objetivo |
| --- | --- |
| 13C | Migrar ultimas rotas/engines: streaming preferences, feedback, watchlist live, sorteio, agenda, rating aggregates |
| 13D | Remover Supabase Auth/deps/wrappers/envs/functions/migrations legadas |
