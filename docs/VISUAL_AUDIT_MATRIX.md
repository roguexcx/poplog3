# Auditoria Visual Multi-Browser e Mobile

O POPLOG agora possui uma auditoria visual automatizada para a versão local atual:

```bash
npm run audit:visual
```

O script gera screenshots e um relatório JSON em `artifacts/visual-audit/`.

## Matriz automatizada

- Chromium desktop.
- Chromium wide.
- Chromium small/mobile.
- Chromium Android emulado.
- Firefox desktop.
- WebKit desktop.
- WebKit iPhone emulado.
- Edge desktop, quando o canal `msedge` estiver instalado.
- Chrome desktop, quando o canal `chrome` estiver instalado.

## Telas auditadas

- Home.
- Busca.
- Página de título filme.
- Página de título série.
- Biblioteca.
- Sorteio.
- Admin.
- Radar atual, smoke básico.
- OG image dinâmica.

## O que o script valida

- Página responde sem HTTP 5xx.
- Conteúdo visível não está vazio.
- Erros de console são capturados.
- Screenshot full-page é salvo para revisão.
- Mobile e telas largas geram artefatos separados.

## Lacuna honesta

Playwright WebKit não substitui Safari real em macOS/iOS. A validação final antes de produção ainda deve passar por:

- Safari real.
- iPhone real.
- Android real.
- Edge e Chrome reais quando disponíveis.

## Radar

Nesta fase, o Radar é testado apenas para garantir que `/radar` não quebra. A auditoria completa de UX do Radar deve acontecer depois do épico Radar V2.
