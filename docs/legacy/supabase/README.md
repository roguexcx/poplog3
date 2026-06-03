# Supabase — Arquivos legados

Este diretório é o destino pretendido para o conteúdo de `supabase/` na raiz do projeto.

Os arquivos ainda estão em `supabase/` na raiz. Para mover definitivamente:

```bash
git mv supabase docs/legacy/supabase
git commit -m "chore: mover supabase/ legado para docs/legacy/supabase/"
```

## Conteúdo original

- `supabase/migrations/` — 26 arquivos SQL (schema PostgreSQL Supabase)
- `supabase/functions/recalculate-curadoria/` — Edge Function para recálculo de scores
- `supabase/seed.sql` — Seed inicial
- `supabase/LEGACY_README.md` — Explicação sobre o legado

## Por que não foi movido automaticamente

Mover diretórios requer `git mv` para preservar o histórico git corretamente.
O comando acima deve ser executado manualmente ou via CI.
