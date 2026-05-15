# POPLOG 3.0 CLEAN - mapa da desmontagem

## Visual preservado

- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/CleanPage.tsx`
- `src/components/layout/SectionHeader.tsx`
- `src/components/background/CinematicBackground.tsx`
- `src/components/ui/*`

## Logica removida

- `src/app/api/*`
- `src/features/*`
- `src/hooks/*`
- `src/context/*`
- `src/lib/*`
- `src/types/*`
- `supabase/*`
- `middleware.ts`

## Rotas mantidas como palco vazio

- `/`
- `/buscar`
- `/filmes`
- `/series`
- `/sorteio`
- `/agenda`
- `/profile`
- `/settings`
- `/title/[type]/[id]`
- `/estudio/[kind]/[id]`
- `/franquia/[id]`
- `/generos/[media]/[id]`
- `/pessoa/[id]`

## Reconstrucao sugerida

1. Testar uma API externa isolada.
2. Expor uma rota interna mínima.
3. Criar um componente visual pequeno.
4. Adicionar estado local.
5. Só depois religar banco, cache, regras e automações.
