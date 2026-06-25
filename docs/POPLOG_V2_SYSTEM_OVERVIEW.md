# POPLOG V2 - Visão Consolidada do Sistema

Atualizado após a segunda rodada local de implementação e validação final em localhost.

Este documento descreve o funcionamento atual do POPLOG em ambiente local. Ele registra a arquitetura real, as decisões técnicas principais e os pontos que já estão preparados para migração futura, sem assumir deploy ou integração ativa com Hostinger neste momento.

## 1. Princípios atuais

- O desenvolvimento continua local: localhost, Docker local, banco local e storage local.
- A Hostinger é tratada como destino futuro, não como ambiente ativo.
- A identidade canônica do catálogo deve ser IMDb-first.
- APIs externas identificam e renovam dados; o POPLOG deve ler preferencialmente do banco/cache local.
- A Home mantém a curadoria Trakt + Balloonerismm protegida, mas a exibição passa por normalização, locale, cache e identidade local.
- JustWatch é a fonte protagonista de disponibilidade; Balloonerismm fica como fallback residual.
- Interface, catálogo e disponibilidade usam preferências separadas de idioma/região.

## 2. Identidade e catálogo

A fundação Prisma `00000000000013_poplog_v2_foundation` adicionou a base para identidade local, aliases, traduções, assets, overrides, auditoria admin e biblioteca orientada a IMDb. Nesta rodada, os fluxos passaram a receber e propagar `imdbId` de forma mais consistente em busca, Home, Radar, Sorteio, providers e página de título.

IDs auxiliares como Trakt, TMDB, Wikidata e Balloonerismm continuam úteis para descoberta, enriquecimento e compatibilidade, mas devem ser tratados como aliases. Slugs e IDs sintéticos existem para rotas antigas e títulos sem TMDB positivo, mas não devem substituir o IMDb como referência principal quando ele existir.

## 3. Locale global

O POPLOG agora possui preferências separadas para:

- `interfaceLanguage`
- `catalogLanguage`
- `availabilityRegion`

Essas preferências ficam em `UserCuradoriaPreference` quando o usuário está logado e também são refletidas em cookies:

- `poplog_interface_language`
- `poplog_catalog_language`
- `poplog_region`

Há um seletor fixo no footer para troca rápida de idioma/região. Ele grava a preferência no perfil quando há usuário autenticado e também mantém cookies para navegação anônima. As rotas principais leem query params ou cookies para aplicar idioma/região em Home, busca, Radar, Sorteio, página de título e providers.

A camada de mensagens de interface foi ampliada para cobrir a interface existente em `src/app`, `src/components` e `src/features`. A rodada de limpeza externalizou 839 mensagens para `src/lib/i18n/generated-ui-messages.json`, com entradas `pt-BR` e `en-US`, e adicionou `uiMessage()` como helper central para renderização de cópia localizada. A auditoria AST `audit:i18n -- --fail-on-hardcoded` agora retorna 0 candidatos de texto hardcoded nos arquivos de interface auditados.

## 3.1 Compliance, consentimento e aviso legal

A camada de compliance local foi adicionada sem ativar rastreamento nao essencial por padrao:

- `docs/legal/DISCLAIMER.md`: aviso legal PT-BR/EN declarando que o POPLOG e indexador/curador de metadados, nao hospeda, nao transmite, nao distribui e nao realiza streaming de obras audiovisuais;
- `src/lib/legal/disclaimer.ts`: versao programatica curta do aviso legal para UI/modal/pagina futura;
- `src/lib/legal/consent-schema.json`: schema JSON para persistir aceite de Termos, Politica de Privacidade e categorias de cookies;
- `src/lib/legal/consent-storage.ts`: helpers client-side para criar, ler, gravar e aceitar consentimento essencial em `localStorage`.

Cookies essenciais continuam separados de analytics, anuncios e personalizacao nao essencial. A persistencia recomendada e `localStorage` para visitante anonimo e banco para usuario autenticado.

## 4. Home, Trending, Hero, Em Alta e Rankings

A alimentação de curadoria da Home permanece protegida, preservando Trakt + Balloonerismm. A mudança desta rodada está na estrutura de exibição:

- cache segmentado por idioma/região;
- logs com região/idioma;
- preservação de `imdbId` nos itens;
- enriquecimento local quando possível;
- providers anexados por região;
- fallback local com aliases externos.

A curadoria decide o que entra; a apresentação deve ser responsabilidade da camada POPLOG.

## 5. Busca

A busca geral permanece Trakt-first, com Balloonerismm como fallback residual. A rota de busca agora propaga idioma e região para a source-engine. O objetivo é que a engine externa identifique o título e entregue o melhor identificador possível, preferencialmente IMDb, enquanto o POPLOG assume identidade, cache, tradução, assets e exibição.

Foi adicionado `src/hooks/useDebouncedGlobalSearch.ts` como hook client-side para busca global instantanea com:

- debounce configuravel;
- cancelamento de request anterior por `AbortController`;
- protecao contra resposta fora de ordem;
- cache curto em memoria por `query + language + region`;
- chamada `no-store` para evitar cache acidental do navegador em interacoes vivas.

Foi adicionado `src/components/skeletons/MediaGridSkeleton.tsx` como skeleton responsivo de grid/cards para telas de busca, listas e carregamentos de catalogo.

## 6. Disponibilidade e providers

A disponibilidade foi ajustada para modelo banco-first:

1. consultar disponibilidade local por `imdbId + region + language`;
2. se houver dado fresco, retornar direto;
3. se estiver vencido mas dentro de `staleUntil`, retornar imediatamente e agendar renovação;
4. se não existir ou estiver velho demais, chamar JustWatch, normalizar, salvar e retornar;
5. se JustWatch falhar, usar Balloonerismm como fallback temporário com TTL menor.

Campos relevantes:

- `providerLanguage`
- `fetchedAt`
- `expiresAt`
- `staleUntil`
- `source`
- `sourceRaw`
- ofertas normalizadas

TTL padrão:

- JustWatch comum: 24h;
- títulos quentes/recentes: 6h;
- catálogo frio: até 7 dias;
- fallback Balloonerismm: 6h a 12h.

Categorias esperadas:

- Assinatura Principal;
- Canal Adicional;
- Aluguel;
- Compra;
- Cinema;
- Indisponível na região.

Validação específica:

- `tt0993846` / O Lobo de Wall Street foi reidratado com JustWatch em BR;
- Diamond Films Amazon Channel foi salvo como `subscription` com `accessKind=partner_channel` e variante `Via Prime Video`;
- aluguel foi salvo para Amazon Video, Apple TV Store e Claro video;
- as linhas persistem `checkedAt`, `expiresAt`, `staleUntil`, `source=justwatch` e `rawPayloadJson` compacto para auditoria.

Validação comercial por fixtures:

- `smoke:providers:commercial-fixtures` cobre assinatura principal, canal adicional, aluguel, compra, grátis, anúncios, cinema e indisponível;
- cobre Prime Video incluso versus Prime Video Channels;
- cobre Max/HBO, Disney+, Globoplay, Apple TV+, Apple TV Store, Netflix, Claro Video, Pluto TV, Diamond Films, Telecine, MUBI, Paramount+, MGM+, Universal+ e Looke;
- valida que `CINEMA` do JustWatch não vira provider comercial artificial: cinema é status/janela de lançamento;
- valida que ausência real de provider sem cinema/futuro vira indisponível na região.

## 7. Biblioteca e Para Você

O Para Você já usa cache por usuário + idioma + região e mantém filtro autoritativo contra títulos existentes na biblioteca antes do retorno. A biblioteca deve operar por identidade local/IMDb sempre que disponível.

A página de título e ações de biblioteca enviam `imdbId`, `poplogId`, `slug`, `tmdbId` e `mediaType` quando disponíveis, preservando compatibilidade com estados antigos enquanto a identidade IMDb-first opera como referência principal.

## 8. Página de título

A página de título consome identidade externa/local, providers normalizados, assets, ratings, temporadas, episódios, trailer, cast, recomendações e estado do usuário.

Nesta rodada, a experiência de progresso de séries foi refinada:

- ação principal separa começar/atualizar progresso de marcar tudo em dia;
- resumo compacto mostra episódios marcados e total do catálogo;
- modal de progresso explica a seleção de temporada/episódio;
- botões foram renomeados para reduzir ambiguidade: `Marcar lançados`, `Marcar temporada`, `Até T/E`;
- navegador de episódios mostra progresso por temporada e ações diretas;
- marcação de episódio continua protegida contra saltos acidentais, perguntando se deve marcar episódios anteriores.

A primeira visita fria de séries foi suavizada: quando não há temporadas/episódios no banco, a página agora monta stubs a partir da contagem conhecida e agenda hidratação por worker (`series-episodes`) em vez de bloquear a renderização com hidratação externa completa. As flags `POPLOG_TITLE_COLD_SEASON_LIST_SYNC=true` e `POPLOG_TITLE_COLD_SERIES_SYNC=true` mantêm o comportamento síncrono disponível para depuração pontual.

Validação visual local:

- `/title/movie/tt0993846` redireciona para a URL canônica local e renderiza O Lobo de Wall Street com providers JustWatch;
- `/title/tv/tt0903747` redireciona para a URL canônica local e renderiza Breaking Bad com temporadas/episódios;
- com auth local, a série exibe Watchlist, Começar série, Marcar em dia, Pausar série, abas T01-T05 e Marcar lançados;
- o painel de progresso abre sem erro e exibe Atualizar progresso, Marcar T1 e ações por episódio.

## 9. Radar

O Radar foi readaptado para usar Trakt como fonte estrutural de datas e tendências, com enriquecimento local por IMDb, traduções, assets e região. A rota também lê idioma/região por query ou cookies.

O Radar deve usar Trakt como fonte principal de calendários, estreias, datas, episódios, lançamentos e tendências quando fizer sentido. O objetivo é que a fonte externa entregue o evento e os identificadores; a apresentação final deve ser montada pelo POPLOG com identidade local/IMDb, locale, assets e cache.

O payload V2 padrão não inclui mais a estrutura legada duplicada. A compatibilidade antiga fica atrás de `legacy=1`. O cache foi versionado para `radar_trakt_general:v3` e as seções têm limites por relevância/data para reduzir payload e custo de render.

A UI principal agora usa `RadarV2Client` consumindo `RadarPayload` V2 diretamente. A página `/radar` não chama mais `legacy=1`; a compatibilidade legada permanece apenas no endpoint para consumidores temporários. O Radar V2 organiza eventos em blocos `Para mim`, `Acompanhando`, `Hoje`, `Semana`, `Em breve` e `Descoberta`, com busca, filtros e alternância Geral/Para mim via endpoint V2.

## 10. Sorteio

O Sorteio passou a usar banco/cache no momento do sorteio. No endpoint de draw, o fallback externo síncrono foi removido: em cache miss, o pool é montado apenas com base local, sem descoberta externa e sem aquecimento de disponibilidade ao vivo.

Smoke `db:smoke:sorteio-local-draw` confirma:

- pool local sem descoberta externa;
- fallback externo desativado no draw;
- fixture local incluída;
- item sorteado vindo do pool local.

O risco de pool vazio após reset foi reduzido localmente com seed mínimo pós-reset. O script `sorteio:seed-minimum` aplica um conjunto pequeno de títulos populares no catálogo local, e `db:reset:catalog` passa a repor esse mínimo automaticamente após reset aplicado, salvo quando rodado com `--no-minimum-seed` ou `POPLOG_RESET_SKIP_MINIMUM_SEED=true`. A própria engine do Sorteio chama esse guard antes de montar o pool local.

Smoke adicional `db:smoke:sorteio-minimum-pool` confirma:

- seed mínimo elegível no banco;
- pool local sem chamada externa;
- volume mínimo para sorteio;
- seleção de item válido a partir do banco/cache.

## 11. Admin, overrides e rollback

O painel administrativo agora opera em camadas: uma aba operacional consolidada para saúde e reprocessamento, além das abas específicas de catálogo, usuários, Radar, workers e engine.

A aba `Operações` centraliza:

- painel de providers problemáticos;
- reprocessamento manual de provider por IMDb/região/idioma;
- revisão SEO por título incompleto;
- revisão de traduções ausentes ou incompletas;
- inspeção de cache por título, incluindo chaves locais e Redis quando configurado;
- logs administrativos filtráveis;
- alertas de jobs atrasados, travados ou falhos;
- revisão de assets/pôsters;
- reprocessamento manual do Radar Trakt;
- saúde de workers/cron;
- títulos/jobs com erro de hidratação;
- botões para reidratar título, provider, episódios e assets.

Foram criadas rotas admin para:

- consultar visão de catálogo por IMDb;
- listar e salvar overrides;
- reverter overrides;
- listar assets;
- selecionar poster como override;
- listar usuários;
- limpar cache;
- consultar snapshot operacional avançado;
- acionar reprocessamentos manuais com auditoria;
- registrar ações em `AdminActionLog`.

Overrides são granulares por campo, idioma e região. Rollback cria nova ação de auditoria e invalida cache relacionado.

Gestão de usuários agora é persistente:

- `User.role` suporta `user`, `admin` e `master`;
- `User.accessStatus` suporta `active` e `blocked`;
- bloqueio, reativação, alteração de role e permissões granulares são gravados no banco;
- auth local e AuthJS recusam usuários bloqueados;
- ações administrativas geram `AdminActionLog`.

A fila persistente também reconhece jobs manuais de `title`, `assets`, `availability`, `series-episodes` e `radar`, permitindo que o Admin execute operações imediatamente ou deixe o cron/worker processar em segundo plano.

## 12. Assets e storage

O storage atual é local e desacoplado:

- `./storage/posters/`
- `./storage/backdrops/`
- `./storage/logos/`
- `./storage/profiles/`

O banco deve salvar `assetKey`, não caminho físico absoluto. A rota `/storage/...` resolve asset keys locais em desenvolvimento. O componente de imagem centralizado aceita `assetKey` e monta URL conforme ambiente.

Existe worker local para baixar imagem externa, validar, salvar no storage, registrar `TitleAsset` e gerar variantes WebP/AVIF quando `sharp` estiver disponível. Sem `sharp`, ele funciona em modo degradado salvando o original.

Essa estrutura prepara futura troca para storage S3-compatible/CDN sem alterar o banco. Nesta rodada foi adicionada a implementação opcional `POPLOG_STORAGE_DRIVER=s3`, mantendo `local` como padrão. O mesmo contrato `assetKey` funciona nos dois modos; as variáveis `POPLOG_S3_ENDPOINT`, `POPLOG_S3_BUCKET`, `POPLOG_S3_ACCESS_KEY_ID`, `POPLOG_S3_SECRET_ACCESS_KEY`, `POPLOG_S3_REGION`, `POPLOG_S3_FORCE_PATH_STYLE` e `POPLOG_ASSET_PUBLIC_BASE_URL` permitem validar bucket/CDN futuro sem migração de schema. Também foi adicionado MinIO ao Docker Compose como bucket S3-compatible real local para validar upload, leitura, URL pública e remoção.

## 13. Cache

O padrão de cache localizado foi expandido para fluxos principais. Exemplos de chave:

- `title:tt5950044:pt-BR:BR`
- `search:superman:pt-BR:BR`
- `providers:tt0993846:BR:pt-BR`
- `home-trending:pt-BR:BR`
- `radar:BR:pt-BR`
- `sorteio:<user>:pt-BR:BR`

Regra: cache de um idioma/região não deve sobrescrever outro.

## 14. Performance e conexão

A aplicação foi preparada para ambiente futuro com recursos limitados, considerando um plano como Hostinger Business:

- banco-first para reduzir chamadas externas;
- renovação em segundo plano com limite de concorrência;
- TTLs diferentes por tipo de dado;
- workers configuráveis;
- storage por asset key;
- imagens otimizáveis e prontas para CDN futura;
- logs de cache, fonte e refresh;
- variáveis para timeouts/limites de conexão quando aplicável.

Não há migração para Hostinger nesta etapa.

## 15. Monetização futura

Foi adicionada uma base inicial, desligada por padrão, para publicidade compatível com AdSense:

- bootstrap assíncrono controlado por env;
- componente `AdSlot`;
- posições finais preparadas em `AD_PLACEMENTS`;
- slots AdSense por variável de ambiente;
- reserva opcional de espaço;
- anúncios desligados por padrão.

Posições finais preparadas:

- `home_between_blocks`;
- `home_after_rankings`;
- `list_between_results`;
- `title_after_main_content`;
- `radar_between_groups`;
- `library_between_groups`;
- `sidebar_contextual`.

Regra de produto: anúncios não devem cobrir conteúdo, interromper ações críticas, degradar performance ou poluir a navegação.

## 16. Estado de entrega

Operacional nesta rodada:

- storage local desacoplado;
- storage S3-compatible opcional por env, mantendo local como padrão;
- asset key local;
- route local de assets;
- worker de asset local;
- providers JustWatch-first banco-first com `expiresAt`, `staleUntil`, `source` e `rawPayloadJson`;
- matriz de normalização comercial de providers/canais por fixtures, cobrindo os tipos e famílias principais do JustWatch;
- renovação de disponibilidade stale agendada em `poplog_refresh_queue`;
- fila persistente local com claim, lock, retry, complete/fail e worker executável;
- aba Admin de workers;
- endpoint protegido de cron `/api/cron/refresh-workers`;
- heartbeat de cron registrado em `AdminActionLog`;
- monitoramento de workers no Admin com último cron, jobs atrasados e jobs travados;
- workflow agendado `.github/workflows/poplog-worker-cron.yml` para chamar o cron externo a cada 5 minutos quando `POPLOG_CRON_URL` e `POPLOG_CRON_SECRET` estiverem configurados;
- Redis local via Docker Compose, ativado por `REDIS_URL`, com fallback opcional quando a variável estiver vazia;
- locale persistido por usuário/cookie;
- seletor fixo de idioma/região no footer;
- cache localizado em fluxos principais;
- Admin com catálogo, overrides, rollback, assets, usuários, cache, bloqueio, reativação, roles, permissões e auditoria;
- Admin avançado com aba operacional para providers problemáticos, SEO, traduções, cache por título, logs filtráveis, jobs, workers/cron, Radar, assets e reidratação manual;
- Radar com locale e enriquecimento local;
- Radar com UI V2 consumindo `RadarPayload` diretamente, sem `legacy=1` na página;
- Sorteio banco/cache-first no draw, sem chamada externa síncrona;
- seed mínimo pós-reset e guard automático para impedir pool local vazio do Sorteio;
- pré-hidratação de séries populares por fila `series-episodes`;
- página de série agenda hidratação fria em segundo plano por padrão;
- página de título revisada e validada para filme e série com auth local;
- URLs canônicas limpas por slug quando o título já possui slug seguro;
- SEO avançado da página de título com canonical, metadata localizada, Open Graph/Twitter, OG image dinâmica, fallback social e JSON-LD para filme/série;
- base de anúncios futura desligada;
- posições finais de anúncios definidas e validadas por smoke de configuração;
- suíte agregada de regressão local `npm run regression:local`;
- auditoria visual automatizada `npm run audit:visual` disponível, com execução em navegadores pulada por orientação do usuário nesta rodada;
- `.env.production.example` e checklists operacionais de produção futura;
- documentos novos: `LOCAL_REGRESSION_COVERAGE.md`, `VISUAL_AUDIT_MATRIX.md`, `ADS_PLACEMENT_PLAN.md`, `REMOTE_STORAGE_CDN_PLAN.md` e `PRODUCTION_READINESS_CHECKLIST.md`.

Validação final executada nesta rodada:

- `npx prisma validate`: passou;
- `npx prisma migrate status`: banco local atualizado;
- `npm run db:generate`: passou após encerrar o dev server que segurava o engine Prisma no Windows;
- `npm run typecheck`: passou;
- `npm run build`: passou;
- `npm run admin:grant -- --email=psatheler@gmail.com`: passou, promovendo `psatheler@gmail.com` para Admin ativo com permissões operacionais;
- validação direta de sessão local: `/api/auth/current` retornou `role=admin`, `accessStatus=active` e permissões para `psatheler@gmail.com`;
- `npm run audit:poplog-v2`: passou sem clientes proibidos e sem chamadas externas diretas fora das rotas; ainda há 352 referências legadas em documentação/metadados;
- `npm run audit:i18n -- --fail-on-hardcoded`: passou com 0 candidatos de texto hardcoded em `src/app`, `src/components` e `src/features`;
- extração de i18n da interface: 839 mensagens externalizadas para catálogo gerado `pt-BR`/`en-US`;
- varredura ampla adicional de JSX/props visíveis: 0 textos prováveis remanescentes fora de `uiMessage()`;
- `docker compose up -d redis`: subiu `poplog-v3-redis` local em `redis:7-alpine`;
- healthcheck Redis local: `healthy`;
- `redis-cli ping` no container Redis local: `PONG`;
- `npm run cache:smoke:redis`: passou com Redis real, validando PING, SET JSON, GET JSON e DEL por namespace;
- `npm run sorteio:seed-minimum`: passou, criando 12 títulos mínimos elegíveis no catálogo local;
- `npm run db:smoke:sorteio-minimum-pool`: passou, validando pool local mínimo sem chamada externa;
- `npm run db:smoke:refresh-queue`: passou;
- `npm run workers:cron:smoke`: passou, validando 401 sem segredo, Bearer token válido, processamento de job e heartbeat;
- `npm run series:prehydrate:popular -- --limit=6`: enfileirou 6 séries populares pendentes para hidratação em background;
- `POPLOG_WORKER_MAX_CONCURRENCY=1 npm run workers:refresh:once`: processou 1 job `series-episodes` real via Trakt, salvando 8 temporadas e 73 episódios de `tt0944947` em cerca de 4s;
- `npm run smoke:providers:commercial-fixtures`: passou com 25 fixtures, cobrindo 8 assinaturas principais, 10 canais adicionais, 3 aluguéis, 2 compras, grátis e anúncios;
- `npm run smoke:provider-normalization`: passou;
- `npm run smoke:providers:justwatch-cases`: passou para `tt0993846`, com 4 linhas JustWatch e Diamond Films Amazon Channel como assinatura/canal;
- `npm run db:smoke:availability`: passou;
- `npm run smoke:availability-stale`: passou, validando retorno stale imediato e enfileiramento de renovação;
- `npm run smoke:assets-local`: passou, validando escrita, leitura, URL pública e remoção no storage local;
- `docker compose up -d minio minio-init`: subiu bucket S3-compatible local `poplog-assets`;
- `npm run smoke:assets-s3-local`: passou, validando driver S3 com upload, `exists`, leitura, URL pública e remoção no bucket MinIO;
- smoke HTTP com o servidor apontado para `POPLOG_STORAGE_DRIVER=s3` em `http://localhost:3001`: passou com Home/cards 200, busca 200, página de título filme/série 200, providers 200, Radar 200, Admin 200 e OG image PNG 200;
- `npm run smoke:cold-series`: passou, validando primeira visita fria de série com temporadas/stubs disponíveis dentro do teto local;
- `npm run smoke:ads-placement`: passou, validando posições finais de anúncios desligadas por padrão;
- smoke HTTP local com auth local: health OK, Home 200, Trending 200, Busca 200, Providers 200, Radar 200, Para Você 200, Biblioteca 200 e Sorteio 200;
- `npm run smoke:local-http`: passou, cobrindo Home, busca `pt-BR/BR` e `en-US/US`, redirect 308, página de título filme/série, providers, Radar mínimo, Para Você, Biblioteca protegida, Sorteio protegido, Admin e OG image dinâmica;
- rota antiga `/title/movie/tt0993846`: 308 para `/the-wolf-of-wall-street-2013`;
- rota limpa `/the-wolf-of-wall-street-2013`: 200 com canonical;
- `npm run smoke:seo:title`: passou, validando canonical, slug limpo, JSON-LD `Movie`, JSON-LD `TVSeries`, `og:image`, `twitter:image`, fallback social PNG, locale `en_US` via cookie e PNGs dinâmicos de compartilhamento;
- `npm run audit:visual`: ferramenta criada e Playwright instalado. A execução em navegadores foi pulada por orientação do usuário; screenshots/relatório ficam disponíveis em `artifacts/visual-audit/` quando a auditoria for retomada;
- `npm run regression:local`: passou com 23 etapas, incluindo reset dry-run, seed mínimo, Sorteio, Biblioteca, episódios, permissões Admin, providers, availability stale, assets locais, primeira visita fria de série, workers/cron, Redis, i18n, anúncios, SEO, smoke HTTP e performance local;
- `npm run regression:local -- --skip-http`: passou após ajuste do runner Windows, confirmando execução agregada sem depender dos endpoints HTTP;
- limpeza do manifesto dev do Next/Turbopack: `.next` removido com segurança quando rotas novas estavam voltando 404 HTML em localhost; após reinício, `/api/auth/current`, `/api/auth/session`, `/api/user/locale`, `/api/trending`, `/api/ics/agenda/background-refresh` e `/api/radar` voltaram a responder 200 JSON;
- `npm run dev:clean`: adicionado como comando local para limpar apenas `.next` e subir o dev server quando o manifesto dev ficar preso;
- cliente Trakt ajustado para respeitar `cache: "no-store"` sem adicionar `next.revalidate`; calendários grandes do Radar usam esse modo para evitar o erro de cache do Next em payloads acima de 2 MB, mantendo o cache próprio do POPLOG;
- smoke direto de `/api/radar?mode=general&language=pt-BR&region=BR`: passou com payload V2 no topo (`sections`, `filters`, `stats`) e sem estrutura legada duplicada;
- smoke direto de `/radar`: passou com status 200 e sem `legacy=1` na página;
- smoke direto da rota `/api/admin/operations`: passou com 200, retornando alertas, providers problemáticos e logs;
- smoke direto de `provider.rehydrate` via `/api/admin/operations`: passou para `tt0993846`, retornando `available`, fonte JustWatch e 4 ofertas;
- provider debug `tt0993846`: cache hit fresco, 4 providers, `expiresAt` em 2026-06-26;
- Sorteio draw: `externalCalls=0`, `poolSource=local_db`.

Medição local final desta rodada:

- Home: 126 ms;
- Trending: 91 ms;
- Busca: 70 ms;
- Providers `tt0993846`: 253 ms;
- Radar: 12 ms;
- Para Você: 9 ms;
- Biblioteca: 10 ms, com 401 esperado sem sessão;
- Sorteio draw: 32 ms, com 401 esperado sem sessão.

Medição adicional após limpeza do cache dev do Next:

- Home: 231 ms;
- Trending: 87 ms;
- Busca: 208 ms;
- Providers `tt0993846`: 506 ms;
- Radar: 42 ms;
- Para Você: 22 ms;
- Biblioteca: 118 ms, com 401 esperado sem sessão;
- Sorteio draw: 48 ms, com 401 esperado sem sessão.

Riscos técnicos restantes:

- a primeira visita fria a uma série foi reduzida, mas pode exibir stubs até o worker concluir a hidratação de episódios;
- as traduções `en-US` do catálogo gerado foram preenchidas automaticamente e ainda merecem revisão editorial humana;
- a auditoria de i18n cobre interface renderizada, não mensagens técnicas de API, logs internos ou textos de documentação;
- storage S3-compatible foi validado contra bucket MinIO real local; CDN/provedor externo final ainda depende de credenciais e escolha operacional;
- a futura migração Hostinger ainda deve validar limites reais de CPU/RAM, pool de conexão e estratégia de workers;
- a ativação do cron em ambiente real depende de configurar `POPLOG_CRON_URL` e `POPLOG_CRON_SECRET` depois do deploy;
- Redis remoto/gerenciado para produção futura ainda deve ser definido apenas na etapa de migração;
- se o seed mínimo for desativado manualmente no reset, o pool local do Sorteio volta a depender da reidratação do catálogo.
- Safari/iPhone/Android reais continuam fora do ambiente local atual; a auditoria em navegadores foi pulada por orientação do usuário nesta rodada.

## 17. Auditoria contra o Plano Diretor

Esta rodada conclui mais uma fatia funcional importante em localhost, mas ainda não encerra 100% do Plano Diretor completo. O plano original inclui itens de produção, compatibilidade ampla, storage remoto, observabilidade contínua e auditoria multi-browser real que dependem de ambiente externo ou de uma rodada dedicada de cobertura.

Concluído e validado nesta rodada:

- reset controlado e migrações preservadas;
- remoção ativa de OMDb/TheTVDB;
- IMDb-first operacional nos fluxos principais validados;
- Home/Trending protegidos com normalização e locale sem troca do motor de curadoria;
- JustWatch banco-first com cache, TTL, stale e auditoria compacta de ofertas;
- normalização comercial de providers/canais validada por matriz de fixtures cobrindo os tipos e famílias principais;
- renovação de provider stale enfileirada em background;
- `tt0993846` com Diamond Films Amazon Channel via Prime Video;
- Admin funcional com usuários, permissões, bloqueio, auditoria, overrides, rollback, workers e status de fila;
- Admin avançado operacional com providers problemáticos, reprocessamentos manuais, SEO, traduções, inspeção de cache, logs filtráveis, assets, Radar, workers/cron e erros de hidratação;
- Sorteio sem chamada externa síncrona no draw;
- seed mínimo local para Sorteio pós-reset e guard automático no pool;
- pré-hidratação de séries populares via fila persistente;
- Radar Trakt-first reativado, localizado e com payload V2 reduzido;
- Radar V2 completo na UI principal, consumindo `RadarPayload` diretamente, com blocos `Para mim`, `Acompanhando`, `Hoje`, `Semana`, `Em breve` e `Descoberta`;
- página de título revisada e validada para filme e série com auth local;
- i18n de interface externalizado nos arquivos auditados, com 0 candidatos hardcoded no scanner estrito;
- storage local desacoplado por `assetKey`;
- seletor de idioma/região persistido;
- URL pública limpa por slug para títulos com slug seguro;
- SEO avançado de título com OG image dinâmica e structured data validado;
- Redis local real em execução e validado por smoke;
- worker/fila persistente local preparado e testado;
- cron/monitoramento contínuo de workers implementado no código com endpoint protegido, heartbeat, Admin e workflow agendado;
- base de monetização futura desligada, com posições finais configuradas;
- regressão automatizada local agregada criada;
- storage S3-compatible opcional implementado por env, mantendo local como padrão;
- bucket MinIO S3-compatible validado localmente com URL pública, upload, leitura, remoção e smoke HTTP das telas principais em modo S3;
- preparação final de produção futura documentada em `.env.production.example` e checklists;
- build, typecheck, Prisma e smokes principais aprovados.

Parcial ou preparado, não completo em 100%:

- revisão editorial completa das traduções automáticas `en-US`;
- CDN/provedor externo final com URL pública real de produção;
- validação ampla em Safari/iPhone/Android real;
- revisão visual multi-browser do Admin avançado foi pulada por orientação do usuário;
- hardening real de produção/Hostinger, que permanece etapa futura.

Pendente por decisão de escopo desta etapa:

- deploy Hostinger;
- migração real de banco;
- Object Storage/CDN remoto;
- PgBouncer/pooler real de produção;
- Redis remoto/gerenciado de produção;
- ativação real de anúncios;
- auditoria visual completa em aparelhos/navegadores reais.

Conclusão da auditoria: o POPLOG V2 local está funcional e validado nos fluxos centrais desta rodada, mas o Plano Diretor completo ainda possui itens futuros. Portanto, o status correto é "rodada local concluída com pendências externas e de cobertura", não "Plano Diretor completo 100% encerrado".

## 18. Fechamento das 11 pendências anexadas

1. i18n completo da interface: concluído para os arquivos auditados de interface. Foram externalizadas 839 mensagens, o catálogo `pt-BR`/`en-US` foi preenchido, os scripts `i18n:externalize` e `i18n:translate` ficaram registrados e `npm run audit:i18n -- --fail-on-hardcoded` passou com 0 candidatos.
2. Redis real: concluído em localhost. `docker-compose.yml` agora inclui `redis:7-alpine`, `.env.local` define `REDIS_URL=redis://127.0.0.1:6379`, o container `poplog-v3-redis` está `healthy` e `npm run cache:smoke:redis` passou contra Redis real.
3. Workers/filas persistentes e cron: implementado `poplog_refresh_queue` operacional, API Admin, aba Admin, worker local, endpoint protegido `/api/cron/refresh-workers`, heartbeat em `AdminActionLog`, workflow agendado externo e smokes `db:smoke:refresh-queue`, `workers:refresh:once` e `workers:cron:smoke`.
4. URLs finais por slug limpo: implementado `/[slug]` e redirect 308 de `/title/movie/tt0993846` para `/the-wolf-of-wall-street-2013`.
5. Storage remoto/CDN/S3-compatible: backend S3-compatible opcional implementado por env, com local como padrão. Bucket S3-compatible real local via MinIO validado com `smoke:assets-s3-local`, incluindo upload, leitura, existência, URL pública e remoção. Falta apenas trocar para credenciais/CDN do provedor final quando essa conta existir.
6. Teste amplo em navegadores: ferramenta automatizada criada e Playwright instalado; a execução em navegadores foi pulada por orientação do usuário. Safari/iPhone/Android reais continuam validação externa.
7. SEO completo: concluído para página de título em localhost. Há canonical por slug limpo, metadata localizada, Open Graph/Twitter, OG image dinâmica, fallback social, JSON-LD `Movie`/`TVSeries` e smoke `smoke:seo:title` cobrindo indexação e compartilhamento.
8. Provider/canal normalization exhaustive: concluído para a matriz local solicitada. `smoke:providers:commercial-fixtures` cobre assinatura principal, canal adicional, aluguel, compra, cinema, indisponível, Prime incluso vs Channels e famílias Max/HBO, Disney+, Globoplay, Apple TV, Netflix, Claro e canais principais; `smoke:providers:justwatch-cases` mantém o caso vivo `tt0993846`.
9. Admin completo local: concluído para operação avançada em localhost. A aba `Operações` cobre providers problemáticos, reprocessamento manual, revisão SEO, revisão de traduções, inspeção de cache por título, logs filtráveis, alertas de jobs atrasados/travados, assets/pôsters, Radar, workers/cron, erros de hidratação e reidratação de título/provider/episódios/assets. Resta revisão visual multi-browser antes de tratar como acabamento de produção.
10. Cobertura automatizada completa: criada suíte agregada `npm run regression:local`, cobrindo os critérios locais atuais e validando `/radar` + `/api/radar` em V2. A auditoria visual multi-browser foi pulada por orientação do usuário.
11. Hardening produção/Hostinger: arquitetura segue local-first e portável; deploy/hardening real ficam para a etapa de migração.
