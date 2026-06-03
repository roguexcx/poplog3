# Auth Migration Decision

Status: Fase 13A concluida como decisao tecnica, sem implementacao de Auth.js.

## Contexto

O POPLOG v3 ja opera em modo local com MySQL/Prisma por flags. A autenticacao real de producao ainda depende de Supabase Auth, enquanto `POPLOG_LOCAL_AUTH_ENABLED=true` existe como modo local/dev para resolver `LOCAL_USER_ID` via Prisma.

## Opcoes avaliadas

| Opcao | Prós | Contras | Decisao |
| --- | --- | --- | --- |
| Manter Supabase Auth temporariamente | Menor risco imediato; login real atual continua funcionando; permite concluir migracoes de dados primeiro | Mantem envs/deps Supabase e componentes client-side acoplados | Manter ate 13B |
| Local-user apenas | Ja existe e valida smokes locais; remove dependencia de sessao externa em dev | Nao e auth real de producao; sem senha, sessao, reset, OAuth ou seguranca operacional | Usar apenas para dev/smoke |
| Auth.js/NextAuth | Caminho maduro para producao Next.js; pode usar Prisma adapter; desacopla Supabase Auth | Exige schema/sessoes, troca de UI/hooks/middleware e revisao de cookies | Recomendado para producao |
| Login proprio simples | Controle total e pouco pacote externo | Alto risco de seguranca; precisa hash, reset, protecao brute force, sessao, rotacao | Nao recomendado |

## Recomendacao

Implementar Auth.js/NextAuth na Fase 13B, com Prisma como fonte de usuarios/sessoes. Supabase Auth deve permanecer temporariamente ate que:

1. `useAuth`, `LoginDrawer`, `Sidebar`, `proxy.ts` e `HomePage` deixem de depender do client Supabase.
2. `getCurrentUser()` tenha caminho real via Auth.js e mantenha o caminho `local-user` para smokes.
3. Endpoints que usam `createSupabaseServerClient().auth.getUser()` passem a usar `getCurrentUser()`.
4. Seja criado um plano de migracao/sync de usuarios Supabase existentes para `users` local.

## Plano sugerido para 13B

1. Adicionar Auth.js com Prisma adapter e modelos necessarios ao schema.
2. Criar provider inicial seguro para producao (email/senha apenas se houver hashing e reset; caso contrario OAuth/email magic link).
3. Trocar `getCurrentUser()` para priorizar Auth.js quando `POPLOG_LOCAL_AUTH_ENABLED=false`.
4. Adaptar UI de login/logout sem mudar UX visual alem do necessario.
5. Migrar rotas Auth-bound: `streaming-preferences`, `for-you`, `feedback`, `feedback/batch`, `not-interested`, `discover`, `search`, `trending`, `watchlist/live`.

## Decisao de producao

Nao usar `local-user` em producao. Para go-live sem Supabase, usar Auth.js/NextAuth com Prisma. Ate la, manter Supabase Auth temporariamente e documentado.
