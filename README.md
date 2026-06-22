# POPLOG 3.0 CLEAN

Base limpa para reconstrução controlada do POPLOG.

Esta branch mantém a identidade visual e a estrutura mínima do frontend, mas remove a lógica funcional antiga: APIs internas, integrações externas, autenticação, sessões, cache, pipelines, heurísticas, radar, providers e migrations.

## Como rodar

```bash
npm run dev
```

Abra `http://localhost:3000`.

## O que ficou

- Next.js App Router
- React
- Tailwind CSS
- `lucide-react`
- Layout base
- Sidebar desktop/mobile
- Estilos globais
- Páginas neutras para as rotas principais

## O que saiu

- Rotas em `src/app/api`
- Integrações de catálogo e streaming
- Autenticação e middleware de sessão legados
- Hooks e providers de usuário
- Cache e sincronização
- Regras de recomendação, confiança e contexto
- Migrations e scripts de banco antigos

Use o histórico do git como referência técnica do sistema anterior quando precisar consultar a implementação antiga.
