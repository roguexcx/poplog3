# Plano de Posições de Anúncios

Anúncios continuam desligados por padrão:

```env
NEXT_PUBLIC_ADS_ENABLED=false
NEXT_PUBLIC_ADS_RESERVED_LAYOUT=false
```

A base aceita AdSense com carregamento assíncrono e slots por variável de ambiente.

## Posições finais preparadas

- `home_between_blocks`: entre blocos editoriais da Home, nunca no hero.
- `home_after_rankings`: abaixo de rankings e listas principais.
- `list_between_results`: entre grupos longos de resultados.
- `title_after_main_content`: final da página de título, depois das ações principais, providers e episódios.
- `radar_between_groups`: entre grupos do Radar atual; revisão completa fica para o Radar V2.
- `library_between_groups`: entre grupos da Biblioteca/Watchlist.
- `sidebar_contextual`: somente layout largo, nunca mobile.

## Regras de experiência

- Não cobrir conteúdo.
- Não interromper ações críticas.
- Não aparecer dentro de cards clicáveis.
- Não empurrar botões de estado da página de título.
- Não entrar no fluxo de marcar episódios/temporadas.
- Não travar renderização inicial.
- Reservar espaço apenas quando `NEXT_PUBLIC_ADS_RESERVED_LAYOUT=true`.

## Validação

```bash
npm run smoke:ads-placement
npm run audit:visual
```

O primeiro valida a configuração. O segundo valida o impacto visual quando a reserva estiver ligada.
