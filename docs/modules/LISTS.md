# Plano Técnico — Listas Personalizadas

> Camada organizacional sobre o vínculo do usuário com títulos, sem duplicar o estado de Biblioteca / Watchlist / Favoritos / Assistidos / Em andamento.

Status: Fases 1–6 implementadas e validadas em 22/06/2026. Stack alvo: Next.js 16 (App Router) + Prisma (MySQL) + NextAuth, seguindo as camadas já existentes `repository → local-service → service → route → feature/UI`.

---

## 1. Princípio arquitetural central

O ponto mais importante do spec é: **listas não criam estado novo de título**. Hoje o vínculo "usuário ↔ título" e o status (watchlist / watching / watched / abandoned / fridge) vivem em duas tabelas, ambas com chave `(userId, tmdbId, mediaType)`:

- `UserTitle` — registro bruto do vínculo (status obrigatório).
- `UserTitleState` — estado materializado que alimenta as queries da Biblioteca (tabs, contagens, ordenação).

A Watchlist **não é uma tabela**: é `UserTitle.status = 'watchlist'` (e o `computedState` correspondente em `UserTitleState`).

Decisão de design: **a participação em lista é uma tabela própria e independente** (`UserListItem`), referenciando o título por `(tmdbId, mediaType)`. Ela **não** depende da existência de uma linha `UserTitle`/`UserTitleState`.

Isso resolve todos os requisitos sem inventar estado:

| Requisito do spec | Como o modelo atende |
|---|---|
| Adicionar a lista também adiciona à Watchlist (padrão) | Cria `UserListItem` **e** chama o fluxo existente `upsertUserTitleStatus({ status: 'watchlist' })`. |
| Desmarcar "Também adicionar à Watchlist" | Cria **apenas** `UserListItem`; nenhum `UserTitle`/`UserTitleState` é tocado. |
| Título "apenas em listas" continua vinculado ao usuário, mas fora da Watchlist | O vínculo passa a ser a própria linha em `UserListItem` (via `list.userId`). Sem `UserTitleState` → não aparece nas tabs/contagens da Biblioteca. |
| Remover de uma lista remove só aquele vínculo | `DELETE` em um `UserListItem`; nada mais. |
| Remover da Watchlist não remove das listas | `removeUserTitle` mexe só em `UserTitle`/`UserTitleState`; `UserListItem` é tabela separada e sobrevive. |
| Mesmo título em múltiplas listas | N linhas em `UserListItem` (uma por lista), mas **um único** estado de título. Zero duplicação real. |
| Evitar duplicação no estado do usuário | Status permanece com fonte única (`UserTitle`/`UserTitleState`); listas só apontam para o título. |

> **Por que não criar um novo valor de `LibraryStatus` (ex.: `saved`)?** Porque introduziria um estado paralelo que toda a engine (continuity, curadoria, contagens, ordenação) teria que aprender a ignorar — exatamente a "duplicação/conflito de estado" que o objetivo pede para evitar. Manter a participação em lista fora do enum mantém a Biblioteca intacta.

---

## 2. Modelo de dados (Prisma)

Três mudanças: `username` no `User`, dois modelos novos.

### 2.1 `User.username`

```prisma
model User {
  // ...campos existentes...
  username String? @unique @db.VarChar(64)

  // relações existentes...
  lists   UserList[]
}
```

- `nullable` na primeira migração para permitir backfill (ver §3).
- Único, indexado (já vem com `@unique`).
- Usado na rota `/u/[username]/listas/...`.

### 2.2 `UserList`

```prisma
model UserList {
  id          String   @id @default(cuid()) @db.VarChar(191)
  userId      String   @map("user_id") @db.VarChar(191)
  shortId     String   @unique @map("short_id") @db.VarChar(16) // estável p/ URL
  name        String   @db.VarChar(120)
  slug        String   @db.VarChar(160)                          // derivado do name
  description String?  @db.Text
  isPublic    Boolean  @default(false) @map("is_public")         // base p/ fase futura
  shareToken  String?  @unique @map("share_token") @db.VarChar(32) // base p/ link sharing (null por ora)
  position    Int      @default(0)                               // ordem das listas na Biblioteca
  itemCount   Int      @default(0) @map("item_count")            // cache de contagem
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user  User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  items UserListItem[]

  @@unique([userId, name])      // nomes únicos por usuário (evita confusão na UI)
  @@index([userId, position])
  @@map("user_lists")
}
```

Notas:
- **`shortId`** (≈6–8 chars base62, gerado no app) é a âncora estável da URL. O `slug` pode mudar em renomeações sem quebrar links — a página resolve por `shortId` e redireciona (308) se o slug não bater. Esse padrão já deixa o terreno pronto para compartilhamento por link.
- **`isPublic` + `shareToken`** são a base "preparada para o futuro" sem implementar nada agora: ambos ficam `false`/`null`. Quando entrar a fase de compartilhamento, basta gerar o `shareToken` e adicionar uma rota pública — **sem migração estrutural pesada**.
- **`itemCount`** é cache para renderizar os cards de coleção e a contagem da página sem `COUNT` por lista. Mantido em transação com inserts/deletes de itens.

### 2.3 `UserListItem`

```prisma
model UserListItem {
  id        String    @id @default(cuid()) @db.VarChar(191)
  listId    String    @map("list_id") @db.VarChar(191)
  tmdbId    Int       @map("tmdb_id")
  mediaType MediaType @map("media_type")
  position  Int       @default(0)        // ordenação manual dentro da lista
  note      String?   @db.Text           // anotação opcional por item (futuro-friendly)
  addedAt   DateTime  @default(now()) @map("added_at")

  list UserList @relation(fields: [listId], references: [id], onDelete: Cascade)

  @@unique([listId, tmdbId, mediaType])  // mesmo título não duplica na mesma lista
  @@index([listId, position])
  @@index([tmdbId, mediaType])           // lookup reverso: "este título está em quais listas?"
  @@map("user_list_items")
}
```

Notas:
- Referencia o título por `(tmdbId, mediaType)` — **mesma identidade** usada por `UserTitleState`/`UserTitle`, então o "indicador discreto de lista" nos cards é um join barato.
- `position` habilita ordenação manual (drag-and-drop). Estratégia de reordenação em §5.
- `onDelete: Cascade` a partir de `UserList`: excluir a lista limpa os itens. Excluir um título de uma lista é só deletar o item — não afeta `UserTitle`.

---

## 3. Migração e backfill

Seguindo o padrão sequencial existente (`prisma/migrations/0000000000001X_...`):

1. **`...10_user_lists`** — cria `user_lists`, `user_list_items`, adiciona `users.username` (nullable).
2. **Backfill de `username`** — script `scripts/backfill-usernames.ts` (mesmo molde dos `scripts/backfill-*.ts`):
   - Deriva de `email` (parte antes do `@`) → normaliza (`a-z0-9-`) → garante unicidade com sufixo numérico em colisão (`phil`, `phil-2`).
   - Fallback para `name` ou `user-{cuid8}` quando não houver email.
   - Idempotente, com `--dry-run`.
3. (Opcional, fase posterior) tornar `username` `NOT NULL` após backfill + ponto de captura no fluxo de signup. **Não** obrigatório para esta entrega.

Ponto de signup: garantir geração de `username` na criação de usuário (callback do NextAuth / adapter) para que novos usuários já nasçam com slug de rota.

---

## 4. Camada de servidor

Espelhar a estrutura atual (`repository` puro → `local-service` orquestra estado/eventos → `service` é a fachada → `route`).

### 4.1 Repository — `src/server/repositories/user-list.repository.ts`

Funções puras de acesso (sem regra de negócio cruzada):

- `createList({ userId, name, description? })` → gera `shortId` + `slug`, `position = max+1`.
- `updateList({ listId, userId, name?, description? })` → renomear regenera `slug` (mantém `shortId`).
- `deleteList({ listId, userId })`.
- `reorderLists({ userId, orderedIds })`.
- `getListByShortId({ shortId })` / `getListById`.
- `listListsForUser({ userId })` (inclui `itemCount` e capas para mosaico).
- `addItem({ listId, tmdbId, mediaType })` (idempotente via unique; `position = max+1`; incrementa `itemCount` na mesma transação).
- `removeItem({ listId, tmdbId, mediaType })` (decrementa `itemCount`).
- `reorderItems({ listId, orderedItemIds })`.
- `getListItems({ listId })`.
- `getListMembershipForTitles({ userId, titles[] })` → mapa `(tmdbId,mediaType) → listId[]`, para badge/indicador na Biblioteca.

### 4.2 Service — `src/server/lists/list-service.ts`

Fachada que aplica a **regra principal** (Watchlist por padrão) e orquestra com o serviço de Biblioteca existente:

```ts
async function addTitleToLists({
  userId, tmdbId, mediaType, listIds, alsoAddToWatchlist,
}): Promise<...> {
  // 1. adiciona o item em cada lista (idempotente)
  for (const listId of listIds) await repo.addItem({ listId, tmdbId, mediaType });

  // 2. regra padrão: também entra na Watchlist, salvo desmarcado
  if (alsoAddToWatchlist) {
    const current = await getUserTitleStatus(userId, tmdbId, mediaType);
    if (!current) {
      // só promove a watchlist se ainda não houver vínculo de status,
      // para nunca rebaixar watching/watched → watchlist
      await upsertUserTitleStatus({ userId, tmdbId, mediaType, status: "watchlist" });
    }
  }
  // se alsoAddToWatchlist === false: nada além do passo 1 (fica "só na lista")
}
```

Regras-chave embutidas aqui:
- **Nunca rebaixar status**: se o título já está `watching`/`watched`/`favorite`, não sobrescreve para `watchlist`.
- `removeTitleFromList` → só `repo.removeItem`. Não toca `UserTitle`.
- Não há gancho no sentido inverso: `removeUserTitle` (Biblioteca) **não** importa nada de listas — garantia já dada pela separação de tabelas (documentar com teste de regressão).
- Resolução do par `(tmdbId, mediaType)` reaproveita `resolveUserStateIdentity` (mesma usada em `/api/library/title`) para aceitar `poplogId`/`imdbId`/`slug`.

### 4.3 Eventos
Emitir `UserEvent` (`eventType: "list_item_added" | "list_item_removed"`) seguindo o padrão de `createUserEvent`, para telemetria/curadoria futura. Opcional mas barato.

---

## 5. Ordenação manual (itens e listas)

- Campo `position` inteiro; render `ORDER BY position ASC`.
- Reordenação: o cliente envia a nova ordem completa de IDs; o servidor reescreve `position` em lote dentro de uma transação (simples e robusto para listas pessoais, que são pequenas). Evita o problema de "buracos"/rebalanceamento de fracionários nesta escala.
- Itens podem ser arrastados por uma alça via biblioteca já presente (`framer-motion` `Reorder`); botões de mover dão alternativa acessível por mouse/teclado. A ordem das listas na estante usa controles explícitos com animação de layout do `framer-motion`. Nenhuma dependência nova.

---

## 6. API (App Router) — `src/app/api/lists/...`

Todas exigem sessão (`getCurrentUser`) e validam que a lista pertence ao usuário. Padrão de resposta `{ success, data }` / `{ error }` como nas rotas atuais, com `logRouteResult`.

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/lists` | Lista as listas do usuário (com `itemCount` + capas p/ mosaico). |
| `POST` | `/api/lists` | Cria lista `{ name, description? }`. |
| `PATCH` | `/api/lists/[id]` | Renomeia/edita `{ name?, description? }`. |
| `DELETE` | `/api/lists/[id]` | Exclui lista. |
| `POST` | `/api/lists/reorder` | Reordena listas `{ orderedIds }`. |
| `GET` | `/api/lists/[id]/items` | Itens da lista (hidratados p/ grid). |
| `POST` | `/api/lists/items` | **Adiciona título a 1+ listas** `{ tmdbId, mediaType, listIds, alsoAddToWatchlist }`. |
| `DELETE` | `/api/lists/[id]/items` | Remove título de uma lista `{ tmdbId, mediaType }`. |
| `POST` | `/api/lists/[id]/items/reorder` | Ordena itens `{ orderedItemIds }`. |
| `GET` | `/api/lists/membership?titles=...` | Mapa de pertencimento p/ indicador nos cards. |

Hidratação dos itens (poster, título localizado, ano) reaproveita o pipeline de imagens/títulos já usado pela Biblioteca (`resolveCatalogImage`, `resolveDisplayTitle`, `TmdbImage`).

---

## 7. Rota da página da lista

`src/app/u/[username]/listas/[handle]/page.tsx`, onde `handle = "[shortId]-[slug]"`.

- Server Component: faz `split` do `handle` no primeiro `-` após o `shortId` (o `shortId` tem tamanho fixo, então o parse é trivial), resolve a lista por `shortId`.
- **Autorização (v1, tudo privado):** renderiza apenas se `session.user.id === list.userId`. Caso contrário `notFound()`.
- **Canonicalização:** se `slug` na URL ≠ slug atual da lista → `redirect(308)` para a URL correta (mantém links após renomeação; pré-requisito limpo para sharing).
- Conteúdo (conforme spec): nome, descrição opcional, contagem de títulos, grid de títulos, filtros básicos (tipo de mídia, busca textual), ordenação manual, ações editar/renomear/excluir, botão "adicionar títulos".
- Reaproveita `LibraryGrid` / `LibraryPosterCard` para consistência visual.

> Preparação para sharing (sem implementar agora): quando `isPublic` virar `true`, uma rota irmã `/listas/s/[shareToken]` (ou liberação condicional desta mesma página por token) exibe a lista sem exigir dono. O modelo de dados já comporta — nenhuma reestruturação.

---

## 8. UI — Biblioteca

Nova seção **"Suas Listas"**, inserida em `src/features/library/LibraryPage.tsx` **abaixo dos cards de contagem e antes dos blocos principais** de conteúdo.

- Novo componente `src/features/library/ListsShelf.tsx`: faixa de **cards de coleção** (navegação, não carrossel de títulos).
- Cada card: nome, contagem, **mosaico automático** (2×2) com as capas dos primeiros itens, ação de abrir (`Link` para a rota da lista).
- Card extra **"+ Criar nova lista"** abrindo modal de criação.
- **Indicador discreto** nos cards de título: pequeno ícone (ex.: `lucide` `ListPlus`/`Layers`) quando o título pertence a ≥1 lista — **sem múltiplos badges**. Dados vindos de `/api/lists/membership` (ou pré-carregados no server component da Biblioteca para evitar waterfall). As listas específicas de um título aparecem só no **menu de ações/popover**, não estampadas no card.

Componentes novos: `ListsShelf.tsx`, `ListCollectionCard.tsx`, `CreateListModal.tsx`.

---

## 9. UI — Página de título

Ajustar `src/features/title/TitleActions.tsx` para o layout:

```
[ Watchlist ▼ ]  [ Marcar como visto ]  [ Favorito ]  [ Adicionar à lista ]
```

Novo botão **"Adicionar à lista"** → abre `AddToListPopover` (`src/features/title/AddToListPopover.tsx`) com:

- listas existentes do usuário com **checkboxes** (multi-seleção; reflete pertencimento atual);
- opção **"Criar nova lista"** inline (reusa `CreateListModal`);
- checkbox **"Também adicionar à Watchlist"**, marcado por padrão;
- botão **Salvar** → `POST /api/lists/items`.

Comportamento do checkbox da Watchlist (conforme spec):
- Se o título **já está** na Watchlist (ou em qualquer status de biblioteca) → checkbox **marcado e desabilitado** (ou omitido), pois o vínculo já existe.
- Se **não está** → habilitado e marcado por padrão; desmarcar salva **apenas** na(s) lista(s).

Estado de pertencimento inicial vem de `initialState` (já passado ao `TitleActions`) + um fetch leve das listas do título.

---

## 10. Casos de borda e invariantes (cobrir com smoke tests)

Seguindo o padrão `scripts/smoke-test-*.ts` + `db:smoke:*`:

1. **Adicionar a lista com Watchlist marcado** cria item + promove a watchlist **só se não houver status** (não rebaixa `watching`/`watched`).
2. **Adicionar a lista com Watchlist desmarcado** cria item e **não** cria `UserTitle`/`UserTitleState`; título não aparece nas tabs da Biblioteca.
3. **Remover da Watchlist** (`removeUserTitle`) mantém todos os `UserListItem`.
4. **Remover de uma lista** não afeta `UserTitle`/outras listas.
5. **Mesmo título em N listas** → 1 estado, N itens; sem duplicação.
6. **Excluir lista** remove só seus itens (cascade); estado dos títulos intacto.
7. **Renomear lista** muda `slug`, preserva `shortId`; URL antiga redireciona.
8. **Unicidade**: nome de lista por usuário, item por lista, `shortId`/`username` globais.
9. **Autorização**: usuário não consegue ler/editar lista de outro (v1 privada).

`db:smoke:lists` cobrindo 1–9.

---

## 11. Faseamento sugerido

1. **Fundação** — migração (models + `username`), backfill de username, repository, geração de `shortId`/`slug`.
2. **Serviço + API** — `list-service` com a regra da Watchlist, rotas `/api/lists/*`, smoke tests (§10).
3. **Biblioteca** — `ListsShelf` + `CreateListModal` + indicador discreto nos cards.
4. **Página de título** — botão "Adicionar à lista" + `AddToListPopover`.
5. **Página da lista** — rota `/u/[username]/listas/[handle]` com grid, filtros, ordenação manual, ações.
6. **Polimento** — ordenação manual, estados de loading/erro/vazio, responsividade e verificação final.

Todas as etapas acima foram concluídas. A telemetria específica de listas permanece opcional e não faz parte do comportamento funcional desta entrega.

---

## 12. Resumo de arquivos

**Schema/DB**
- `prisma/schema.prisma` (+`username`, +`UserList`, +`UserListItem`)
- `prisma/migrations/00000000000010_user_lists/`
- `scripts/backfill-usernames.ts`
- `scripts/smoke-test-lists.ts`

**Servidor**
- `src/server/repositories/user-list.repository.ts`
- `src/server/lists/list-service.ts`
- `src/app/api/lists/route.ts` (+ `[id]`, `reorder`, `items`, `[id]/items`, `[id]/items/reorder`, `membership`)

**UI**
- `src/features/library/ListsShelf.tsx`, `ListCollectionCard.tsx`, `CreateListModal.tsx`
- `src/features/title/AddToListPopover.tsx` (+ edição em `TitleActions.tsx`)
- `src/app/u/[username]/listas/[handle]/page.tsx` (+ componentes da página)

**Sem mudança estrutural** em `UserTitle` / `UserTitleState` / engine de Biblioteca — só leituras de pertencimento.

---

## 13. Validação concluída

- Fluxo visual ponta a ponta: criar pela Biblioteca, criar pelo seletor do título, adicionar com e sem Watchlist, usar múltiplas listas, renomear, abrir URL canônica, filtrar, ordenar, remover item e excluir com confirmação.
- Invariantes confirmados: remover da Watchlist mantém as listas; remover/excluir lista mantém o estado da Biblioteca; um título somente em lista não aparece na Watchlist.
- Privacidade e resolução por `shortId` cobertas pelo smoke test do serviço; acesso não proprietário retorna como inexistente.
- Layout conferido em desktop e viewport móvel, sem erros de console relacionados à feature.
