# Rotas degradadas — estado pós-remoção Supabase

Data: 2026-06-03. Atualizar quando as rotas forem implementadas via Prisma.

## Rotas desativadas (retornam 501 ou 410)

### `GET /api/user/for-you`
**Estado:** 501 Not Implemented  
**Impacto:** Seção "Para você" na home não exibe sugestões personalizadas.  
**Causa:** A rota usava Supabase para scoring personalizado sem caminho Prisma implementado.  
**Próxima ação:** Implementar via Prisma com `userCuradoriaSignals` + `userTitleState`.

### `GET /api/poplog3/continuity/debug`
**Estado:** 501 Not Implemented  
**Impacto:** Rota de debug interno — não visível ao usuário.  
**Causa:** Rota de diagnóstico que comparava dados Supabase vs local. Obsoleta.  
**Próxima ação:** Implementar com dados Prisma ou remover permanentemente.

### `GET /api/poplog3/continuity/title-debug`
**Estado:** 501 Not Implemented  
**Impacto:** Rota de debug interno — não visível ao usuário.  
**Causa:** Mesmo que continuity/debug.  
**Próxima ação:** Implementar com dados Prisma ou remover permanentemente.

### `GET /api/debug/supabase`
**Estado:** 410 Gone  
**Impacto:** Nenhum — rota de diagnóstico Supabase sem sentido pós-remoção.  
**Próxima ação:** Nenhuma. Manter 410 para indicar remoção intencional.

### `GET /api/debug/local-db/acompanhando-diff`
**Estado:** 410 Gone  
**Impacto:** Nenhum — rota de diagnóstico de diff Supabase/local obsoleta.  
**Próxima ação:** Nenhuma. Manter 410.

## Rotas parcialmente degradadas

### `GET /api/trending`
**Estado:** Funcional, mas sem dados de runtime  
**Impacto:** Seção de trending carrega, mas `cachedRows` de runtime está vazio (array vazio em vez de dados Supabase).  
**Causa:** A query de `poplog3_titles` runtime que populava `cachedRows` usava Supabase sem equivalente Prisma implementado.  
**Próxima ação:** Implementar via `db.poplog3Title.findMany()` para popular os dados de runtime.

## Priorização sugerida

| Rota | Impacto usuário | Prioridade |
|---|---|---|
| `/api/user/for-you` | Médio — feature de descoberta | Alta |
| `/api/trending` (runtime data) | Baixo — dados parcialmente presentes | Média |
| `/api/poplog3/continuity/debug` | Zero — debug interno | Baixa |
| `/api/poplog3/continuity/title-debug` | Zero — debug interno | Baixa |
