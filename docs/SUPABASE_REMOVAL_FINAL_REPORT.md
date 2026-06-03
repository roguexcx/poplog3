# Supabase Removal — Relatório Final

Data de conclusão: 2026-06-03
Branch: `codex/loca-db`
Fases executadas: 13A, 13B, 13C, 13C.2, 13D, 13E

## Sumário executivo

O Supabase foi completamente removido do POPLOG v3. Todos os pacotes, variáveis de ambiente, wrappers de cliente e rotas de diagnóstico que dependiam do Supabase foram eliminados ou substituídos. A stack de produção agora é Next.js 16 + Auth.js/NextAuth + Prisma + MySQL, sem qualquer dependência funcional do Supabase.

## Dependências removidas

| Pacote | Versão removida |
|---|---|
| `@supabase/supabase-js` | 2.x |
| `@supabase/ssr` | 0.x |

## Arquivos modificados por categoria

| Categoria | Arquivo | Acao |
|---|---|---|
| Auth server | `src/server/auth/get-current-user.ts` | Removido fallback Supabase Auth |
| Auth server | `src/server/auth/auth-options.ts` | Mantido; sem Supabase |
| Proxy/middleware | `src/proxy.ts` | Removido fallback SSR Supabase |
| Wrappers | `src/server/supabase/*` | Substituídos por stubs que lançam erro |
| Wrappers | `src/lib/supabase/*` | Substituídos por stubs que lançam erro |
| UI auth | `src/components/auth/LoginDrawer.tsx` | Removido formulário Supabase fallback |
| UI auth | `src/components/layout/Sidebar.tsx` | Removido sign-out Supabase fallback |
| UI auth | `src/app/profile/ProfilePageClient.tsx` | Removido sign-out Supabase fallback |
| Personalização | `src/lib/personalization/feedback.ts` | Removido client Supabase |
| Rotas debug | `src/app/api/debug/supabase/route.ts` | Desativada (retorna 410) |
| Rotas debug | `src/app/api/debug/local-db/acompanhando-diff/route.ts` | Desativada (retorna 410) |
| Scripts legados | `scripts/` (backfill Supabase, smokes antigos) | Removidos ou substituídos |
| Config pacotes | `package.json`, `package-lock.json` | Pacotes Supabase desinstalados |

## Variáveis de ambiente removidas

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Rotas desativadas

| Rota | Status | Motivo |
|---|---|---|
| `GET /api/debug/supabase` | 410 Gone | Diagnóstico legado sem função |
| `GET /api/debug/local-db/acompanhando-diff` | 410 Gone | Comparador Supabase vs MySQL obsoleto |

## Resultado dos smokes

Todos os 14 smokes passando após a remoção:

- smoke-test-local-user
- smoke-test-engine-logs
- smoke-test-title-cache
- smoke-test-season-cache
- smoke-test-ratings-cache
- smoke-test-external-ids-cache
- smoke-test-api-usage
- smoke-test-availability
- smoke-test-library
- smoke-test-user-state
- smoke-test-episode-progress
- smoke-test-user-ratings
- smoke-test-feedback-engine
- smoke-test-streaming-preferences
- smoke-test-rating-aggregates

## Verificação de tipos e build

- `npx tsc --noEmit`: PASSOU sem erros
- `npm run build`: PASSOU — 69 páginas geradas

## Notas sobre o diretório `supabase/`

O diretório `supabase/` permanece no repositório mas contém apenas histórico de migrations legadas. Não há nenhum código funcional dependente dele. Pode ser removido em uma limpeza futura do repositório se o histórico não for mais necessário.

## Próximos passos sugeridos

1. Remover o diretório `supabase/` do repositório se o histórico de migrations não for necessário para auditoria.
2. Validar o fluxo completo de Google OAuth em ambiente de staging antes do próximo deploy de produção.
3. Atualizar `.env.example` para refletir apenas as variáveis atuais (sem entradas Supabase).
4. Revisar se algum script de CI/CD ainda referencia variáveis Supabase.
