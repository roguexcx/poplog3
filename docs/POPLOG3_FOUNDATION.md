# POPLOG 3.0 — Fundação Inicial da Arquitetura

## Objetivo deste documento

Este documento registra a fundação técnica inicial da POPLOG 3.0.

A ideia não é documentar features finais. A ideia é explicar:

* como a nova arquitetura foi pensada;
* quais camadas já existem;
* como APIs externas devem ser utilizadas;
* como o banco da v3 foi estruturado;
* quais regras operacionais já foram definidas;
* quais princípios devem ser respeitados conforme o sistema crescer.

A POPLOG 3.0 nasce como uma reconstrução organizada da lógica do projeto.

A identidade visual da v2 pode continuar sendo reaproveitada:

* layouts;
* grids;
* sidebar;
* backgrounds;
* cards;
* estilos;
* componentes visuais.

Porém:

Toda a camada de APIs, cache, sincronização, disponibilidade e inteligência deve ser reconstruída de forma modular, previsível e desacoplada.

---

# Filosofia Principal

## Regra mais importante

A interface NÃO deve depender diretamente de APIs externas.

Fluxo correto:

```text
API externa
→ api-clients
→ normalizers
→ cache/banco
→ interface
```

Fluxo incorreto:

```text
UI
→ API externa diretamente
```

A interface deve consumir:

* dados preparados;
* dados normalizados;
* cache persistido;
* estruturas previsíveis.

---

# Estrutura Server-Side

## Pasta principal

```text
src/server/
```

## Estrutura atual

```text
src/server/
├─ api-clients/
├─ cache/
├─ debug/
├─ normalizers/
├─ rate-limits/
├─ strategies/
└─ types/
```

---

# API Clients

## Objetivo

Separar responsabilidades entre APIs.

Cada API possui:

* client próprio;
* regras próprias;
* cache próprio;
* tipos próprios;
* cooldown próprio;
* estratégia própria.

## APIs atuais

### TMDB

Responsável por:

* catálogo;
* discover;
* trending;
* detalhes;
* imagens;
* trailers;
* créditos;
* temporadas;
* episódios;
* IDs externos;
* providers básicos.

Arquivo:

```text
src/server/api-clients/tmdb/
```

### OMDb

Responsável por:

* IMDb;
* Rotten Tomatoes;
* Metacritic;
* awards;
* ratings externos.

Arquivo:

```text
src/server/api-clients/omdb/
```

### Watchmode

Responsável por:

* fallback técnico de disponibilidade;
* validação regional;
* providers;
* streaming sources.

Arquivo:

```text
src/server/api-clients/watchmode/
```

### MovieOfTheNight

Responsável por:

* radar premium;
* eventos de streaming;
* expiração;
* catálogo regional;
* mudanças incrementais.

Arquivo:

```text
src/server/api-clients/movieofthenight/
```

---

# Normalizers

## Objetivo

Cada API possui formatos diferentes.

A interface não deve conhecer esses formatos.

Os normalizers convertem respostas externas em entidades internas da POPLOG.

## Estruturas atuais

### PoplogTitle

Arquivo:

```text
src/server/types/title.ts
```

Responsável por:

* título;
* poster;
* backdrop;
* overview;
* release date;
* year;
* popularity;
* genres;
* TMDB identity.

### normalizeTmdbTitle

Arquivo:

```text
src/server/normalizers/tmdb-title.ts
```

Função:

* converter TMDB em entidade canônica POPLOG.

### PoplogRatings

Arquivo:

```text
src/server/types/ratings.ts
```

Responsável por:

* IMDb;
* Rotten Tomatoes;
* Metacritic;
* TMDB score;
* futuro POPLOG Score.

### normalizeOmdbRatings

Arquivo:

```text
src/server/normalizers/omdb-ratings.ts
```

Função:

* transformar ratings OMDb em estrutura canônica.

---

# Estratégias Operacionais

## Objetivo

Transformar decisões implícitas em regras explícitas.

A v3 evita:

```text
"tenta tudo até funcionar"
```

A v3 prefere:

```text
"regras previsíveis"
```

## Arquivos

### api-priority.ts

Define:

* prioridade entre APIs;
* responsabilidades principais.

### fallback-strategy.ts

Define:

* quando usar Watchmode;
* quando enriquecer com OMDb;
* quando usar MovieOfTheNight;
* quando evitar chamadas caras.

---

# Cache Layer

## Objetivo

Evitar dependência de APIs em tempo real.

A UI não deve disparar chamadas externas constantemente.

## Arquivo

```text
src/server/cache/cache-config.ts
```

## TTLs iniciais

### TMDB

* trending: 6h
* discover: 24h
* details: 30 dias

### OMDb

* ratings: 30 dias

### Watchmode

* availability: 7 dias

### MovieOfTheNight

* availability: 14 dias
* events: 14 dias

---

# Rate Limits e Budgets

## Objetivo

Controlar:

* custos;
* abuso;
* cooldowns;
* APIs premium.

## Arquivos

### api-budgets.ts

Define:

* orçamento diário/mensal.

### api-cooldowns.ts

Define:

* intervalo mínimo entre chamadas.

---

# Banco de Dados — Fundação V3

## Filosofia

A v3 NÃO deve destruir a v2.

Toda estrutura nova utiliza prefixo:

```text
poplog3_
```

As tabelas antigas permanecem preservadas.

---

# Tabelas já criadas

## poplog3_titles

Tabela canônica principal.

Responsável por:

* título;
* overview;
* poster;
* backdrop;
* release dates;
* runtime;
* temporadas;
* payload TMDB.

---

## poplog3_title_external_ids

Responsável por:

* imdb_id;
* trakt_id;
* tvdb_id;
* watchmode_id;
* motn_id.

---

## poplog3_title_ratings

Responsável por:

* IMDb;
* Rotten Tomatoes;
* Metacritic;
* TMDB;
* futuro POPLOG Score.

---

## poplog3_providers

Responsável por:

* Netflix;
* Prime Video;
* Disney+;
* Max;
* Globoplay;
* demais provedores.

---

# Segurança

## RLS

As tabelas da v3 utilizam Row Level Security.

## Service Role

A service role deve existir apenas server-side.

Nunca deve ir para o browser.

Variável:

```text
SUPABASE_SERVICE_ROLE_KEY
```

## Observação importante

Durante a fundação da v3:

* as tabelas foram criadas com RLS;
* porém sem grants completos para service_role;
* isso gerou erro 403;
* posteriormente os grants foram corrigidos.

---

# Debug e Observabilidade

## Objetivo

A v3 deve explicar o que está fazendo.

Evitar sistemas invisíveis.

## Estruturas criadas

### ApiLogEntry

Arquivo:

```text
src/server/types/api-log.ts
```

Responsável por:

* logs de APIs;
* status;
* response time;
* cache hits;
* erros.

### logger.ts

Arquivo:

```text
src/server/debug/logger.ts
```

Responsável por:

* logging estruturado.

---

# Rotas de Debug

## /api/debug/health

Verifica:

* se a v3 está viva.

## /api/debug/config

Verifica:

* variáveis críticas;
* sem expor chaves.

## /api/debug/supabase

Verifica:

* conexão real com Supabase;
* grants;
* leitura da tabela poplog3_titles.

---

# Estado Atual da Fundação

## Concluído

### Estrutura server-side

✅ api-clients
✅ normalizers
✅ cache
✅ strategies
✅ rate-limits
✅ debug
✅ types

### APIs

✅ TMDB
✅ OMDb
✅ Watchmode
✅ MovieOfTheNight

### Banco

✅ poplog3_titles
✅ poplog3_title_external_ids
✅ poplog3_title_ratings
✅ poplog3_providers

### Debug

✅ health route
✅ config route
✅ supabase route

---

# O que NÃO foi iniciado ainda

Ainda NÃO fazem parte da fundação:

* home nova;
* discover novo;
* algoritmo pessoal;
* radar;
* agenda;
* recomendações;
* sincronizações automáticas;
* cron jobs;
* UI final;
* score composto real;
* sistema completo de disponibilidade.

---

# Próximas Fases

## Fase 2 — TMDB Core

Objetivo:

* busca limpa;
* discover;
* detalhes;
* cache TMDB;
* página de título mínima;
* salvar no poplog3_titles.

## Fase 3 — Biblioteca + Usuário

Objetivo:

* watchlist;
* watched;
* watching;
* fridge;
* progresso de episódios.

## Fase 4 — Streaming Layer

Objetivo:

* disponibilidade;
* providers;
* Watchmode fallback;
* “nos seus streamings”.

## Fase 5 — Radar + Agenda

Objetivo:

* arrived_streaming;
* expiring_soon;
* agenda;
* eventos.

## Fase 6 — Inteligência POPLOG

Objetivo:

* recomendações;
* POPLOG Score;
* pesos;
* algoritmo pessoal;
* descoberta inteligente.

---

# Filosofia Final

A POPLOG 3.0 não deve nascer gigante.

Ela deve crescer:

* modular;
* previsível;
* documentada;
* observável;
* desacoplada;
* sustentável.

Menos mágica.
Mais clareza.
Mais ecossistema.
