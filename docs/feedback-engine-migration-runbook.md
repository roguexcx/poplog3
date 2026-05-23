# Feedback Engine Migration Runbook

Status: preparado para aplicacao controlada. Nao executar no Supabase remoto sem aprovacao explicita.

Migration alvo:

```text
supabase/migrations/20260522000100_feedback_engine_schema.sql
```

Objetivo:

- Evoluir `user_title_feedback` com contexto editorial.
- Evoluir `user_title_state` com derivados editoriais.
- Normalizar `surface = 'agenda'` para `surface = 'radar'`.
- Substituir a funcao destrutiva `neutralize_negative_feedback_on_positive_title_state()` por uma versao nao destrutiva.
- Preservar feedback bruto e dados legados.

## Regra De Ouro

Antes de aplicar:

- nao aplicar em producao se os pre-checks mostrarem algo inesperado;
- nao aplicar se houver volume incomum de `surface = 'agenda'` sem entender origem;
- nao aplicar se `user_title_feedback` possuir constraints diferentes das esperadas;
- nao aplicar se houver processo de deploy mexendo no feedback ao mesmo tempo;
- exportar os resultados dos pre-checks para comparacao pos-migration.

## Pre-Checks

Execute estes SQLs antes da migration e salve os resultados.

### 1. Estrutura Atual De `user_title_feedback`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_title_feedback'
order by ordinal_position;
```

```sql
select
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns,
  cc.check_clause
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_name = kcu.table_name
left join information_schema.check_constraints cc
  on tc.constraint_schema = cc.constraint_schema
 and tc.constraint_name = cc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'user_title_feedback'
group by tc.constraint_name, tc.constraint_type, cc.check_clause
order by tc.constraint_type, tc.constraint_name;
```

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'user_title_feedback'
order by indexname;
```

### 2. Estrutura Atual De `user_title_state`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_title_state'
order by ordinal_position;
```

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'user_title_state'
order by indexname;
```

### 3. Trigger/Função Destrutiva Atual

```sql
select
  tgrelid::regclass::text as table_name,
  tgname,
  tgenabled,
  pg_get_triggerdef(oid) as trigger_def
from pg_trigger
where not tgisinternal
  and tgname = 'neutralize_negative_feedback_on_positive_title_state';
```

```sql
select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'neutralize_negative_feedback_on_positive_title_state';
```

Sinal esperado antes da migration:

- se a funcao possuir `delete from public.user_title_feedback`, ela ainda e destrutiva;
- se ja estiver apenas `return new`, ela ja foi neutralizada antes.

### 4. Contagem De Feedback Por Tipo

```sql
select
  feedback_type,
  count(*) as total,
  count(*) filter (where coalesce(active, true) = true) as active_total
from public.user_title_feedback
group by feedback_type
order by feedback_type;
```

Se a coluna `active` ainda nao existir, use:

```sql
select feedback_type, count(*) as total
from public.user_title_feedback
group by feedback_type
order by feedback_type;
```

### 5. Contagem De `surface = 'agenda'`

Se a coluna `surface` ja existir:

```sql
select
  count(*) as agenda_surface_total
from public.user_title_feedback
where surface = 'agenda';
```

Se a coluna ainda nao existir, registre como:

```text
surface column absent; agenda_surface_total = 0 before schema expansion
```

### 6. Divergencias `user_titles` Vs `user_title_state`

```sql
with pairs as (
  select
    coalesce(ut.user_id, uts.user_id) as user_id,
    coalesce(ut.tmdb_id, uts.tmdb_id) as tmdb_id,
    coalesce(ut.media_type, uts.media_type) as media_type,
    ut.status as titles_status,
    uts.status as state_status,
    ut.favorite as titles_favorite,
    uts.favorite as state_favorite,
    ut.liked as titles_liked,
    uts.liked as state_liked,
    (ut.id is not null) as in_user_titles,
    (uts.id is not null) as in_user_title_state
  from public.user_titles ut
  full outer join public.user_title_state uts
    on ut.user_id = uts.user_id
   and ut.tmdb_id = uts.tmdb_id
   and ut.media_type = uts.media_type
)
select
  count(*) filter (where in_user_titles and not in_user_title_state) as only_user_titles,
  count(*) filter (where in_user_title_state and not in_user_titles) as only_user_title_state,
  count(*) filter (
    where in_user_titles
      and in_user_title_state
      and titles_status is distinct from state_status
  ) as status_mismatch,
  count(*) filter (
    where in_user_titles
      and in_user_title_state
      and titles_favorite is distinct from state_favorite
  ) as favorite_mismatch,
  count(*) filter (
    where in_user_titles
      and in_user_title_state
      and titles_liked is distinct from state_liked
  ) as liked_mismatch
from pairs;
```

### 7. Baseline De Preservacao De Feedback Bruto

```sql
select count(*) as total_feedback_rows
from public.user_title_feedback;
```

```sql
select
  count(*) filter (where feedback_type = 'hidden') as hidden_total,
  count(*) filter (where feedback_type = 'not_interested') as not_interested_total,
  count(*) filter (where feedback_type = 'disliked') as disliked_total
from public.user_title_feedback;
```

## Aplicacao Controlada

Somente depois de revisar os pre-checks:

1. Abrir o SQL da migration:

```text
supabase/migrations/20260522000100_feedback_engine_schema.sql
```

2. Aplicar em ambiente controlado primeiro.

3. Se for aplicar pelo SQL Editor do Supabase:

- colar a migration completa;
- executar uma vez;
- nao editar partes da migration durante a aplicacao;
- salvar output/erros.

4. Se for aplicar via CLI em ambiente preparado:

```bash
npx supabase migration up
```

ou aplicar manualmente o arquivo SQL conforme processo operacional do projeto.

## Post-Checks

Execute imediatamente depois da migration.

### 1. Novos Campos Em `user_title_feedback`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_title_feedback'
  and column_name in (
    'surface',
    'scope',
    'section_key',
    'expires_at',
    'active',
    'metadata',
    'strength',
    'confidence'
  )
order by column_name;
```

Esperado:

- todas as oito colunas existem;
- `scope`, `active` e `metadata` estao `not null`;
- defaults existem para `scope`, `active` e `metadata`.

### 2. Novos Campos Em `user_title_state`

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_title_state'
  and column_name in (
    'editorial_affinity',
    'editorial_penalty',
    'editorial_score',
    'has_negative_feedback',
    'is_hidden',
    'is_boosted',
    'last_feedback_type',
    'last_feedback_at'
  )
order by column_name;
```

Esperado:

- todas as oito colunas existem;
- campos numericos/booleanos derivados possuem default;
- `last_feedback_type` e `last_feedback_at` podem ser nulos.

### 3. `agenda` Normalizado Para `radar`

```sql
select
  count(*) as agenda_surface_total
from public.user_title_feedback
where surface = 'agenda';
```

Esperado:

```text
agenda_surface_total = 0
```

Opcional:

```sql
select surface, count(*) as total
from public.user_title_feedback
group by surface
order by surface nulls first;
```

### 4. Feedback Bruto Preservado

Compare com os pre-checks:

```sql
select count(*) as total_feedback_rows
from public.user_title_feedback;
```

```sql
select
  feedback_type,
  count(*) as total,
  count(*) filter (where active = true) as active_total
from public.user_title_feedback
group by feedback_type
order by feedback_type;
```

Esperado:

- total de linhas nao diminuiu;
- contagens por `feedback_type` nao diminuiram por causa da migration;
- nenhuma linha foi apagada.

### 5. Função Destrutiva Substituida

```sql
select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'neutralize_negative_feedback_on_positive_title_state';
```

Esperado:

- funcao existe;
- corpo contem `return new;`;
- corpo nao contem `delete from public.user_title_feedback`.

Check direto:

```sql
select
  position(
    'delete from public.user_title_feedback'
    in lower(pg_get_functiondef(p.oid))
  ) as destructive_delete_position
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'neutralize_negative_feedback_on_positive_title_state';
```

Esperado:

```text
destructive_delete_position = 0
```

### 6. Trigger Continua Existindo

```sql
select
  tgrelid::regclass::text as table_name,
  tgname,
  tgenabled,
  pg_get_triggerdef(oid) as trigger_def
from pg_trigger
where not tgisinternal
  and tgname = 'neutralize_negative_feedback_on_positive_title_state';
```

Esperado:

- trigger pode continuar existindo;
- ele aponta para a funcao agora nao destrutiva;
- nao ha efeito colateral de delete.

### 7. Índices

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('user_title_feedback', 'user_title_state')
  and indexname in (
    'user_title_feedback_active_lookup_idx',
    'user_title_feedback_user_type_active_idx',
    'user_title_feedback_contextual_expiry_idx',
    'user_title_state_editorial_score_idx',
    'user_title_state_feedback_flags_idx'
  )
order by tablename, indexname;
```

Esperado:

- cinco indices retornados.

### 8. Constraints

```sql
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  cc.check_clause
from information_schema.table_constraints tc
left join information_schema.check_constraints cc
  on tc.constraint_schema = cc.constraint_schema
 and tc.constraint_name = cc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name = 'user_title_feedback'
  and tc.constraint_name in (
    'user_title_feedback_scope_check',
    'user_title_feedback_surface_check'
  )
order by tc.constraint_name;
```

Esperado:

- `user_title_feedback_scope_check` existe;
- `user_title_feedback_surface_check` existe;
- `surface_check` aceita `radar` e nao aceita `agenda`.

## Smoke Test Do Endpoint Depois Da Migration

Somente em ambiente controlado com usuario autenticado.

### POST `not_interested`

Request:

```http
POST /api/user/feedback
Content-Type: application/json

{
  "tmdb_id": 123,
  "media_type": "movie",
  "feedback_type": "not_interested",
  "surface": "agenda",
  "source": "controlled_migration_smoke"
}
```

Conferir:

```sql
select *
from public.user_title_feedback
where tmdb_id = 123
  and media_type = 'movie'
  and feedback_type = 'not_interested'
order by updated_at desc;
```

Esperado:

- linha existe;
- `surface = 'radar'`;
- `active = true`;
- feedback bruto preservado.

### POST `favorite`

Request:

```http
POST /api/user/feedback
Content-Type: application/json

{
  "tmdb_id": 123,
  "media_type": "movie",
  "command": "favorite",
  "surface": "agenda",
  "source": "controlled_migration_smoke"
}
```

Conferir:

```sql
select
  favorite,
  liked,
  editorial_affinity,
  editorial_penalty,
  editorial_score,
  has_negative_feedback,
  is_hidden,
  is_boosted,
  last_feedback_type,
  last_feedback_at
from public.user_title_state
where tmdb_id = 123
  and media_type = 'movie';
```

Esperado:

- `favorite = true` em `user_title_state`;
- `editorial_score` positivo;
- negativos leves neutralizados no derivado;
- `user_title_feedback` negativo continua existindo.

### DELETE Feedback

Request:

```http
DELETE /api/user/feedback
Content-Type: application/json

{
  "tmdb_id": 123,
  "media_type": "movie",
  "feedback_type": "not_interested"
}
```

Conferir:

```sql
select feedback_type, active, updated_at
from public.user_title_feedback
where tmdb_id = 123
  and media_type = 'movie'
  and feedback_type = 'not_interested';
```

Esperado:

- linha continua existindo;
- `active = false`.

### Eventos

```sql
select event_type, payload, created_at
from public.user_events
where tmdb_id = 123
  and media_type = 'movie'
order by created_at desc
limit 10;
```

Esperado:

- eventos `feedback_applied`;
- `payload.surface = 'radar'`;
- `payload.requestedSurface = 'agenda'`;
- `payload.editorial` presente.

### Nenhuma Escrita Nova Em `user_titles`

Antes do smoke test:

```sql
select *
from public.user_titles
where tmdb_id = 123
  and media_type = 'movie';
```

Depois do smoke test, repetir a query.

Esperado:

- nenhuma linha criada automaticamente por feedback;
- nenhum `status` alterado por liked/disliked/not_interested;
- nenhum watched implicito.

## Rollback Manual Seguro

Rollback preferencial:

- nao apagar dados;
- nao remover colunas imediatamente;
- reverter comportamento por codigo primeiro, se o problema for endpoint/engine.

### Se O Endpoint Apresentar Problema

1. Reverter deploy do codigo para a versao anterior.
2. Manter colunas novas no banco.
3. Manter feedback bruto preservado.
4. Investigar eventos em `user_events`.

### Se A Função Não Destrutiva Precisar Ser Revertida Temporariamente

Evitar restaurar delete destrutivo. Se for inevitavel por emergencia, pausar writes de feedback antes.

Versao segura preferida:

```sql
create or replace function public.neutralize_negative_feedback_on_positive_title_state()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  return new;
end;
$$;
```

### Se Precisar Desativar Uso Dos Campos Novos

Nao remover colunas. O codigo ja possui fallback quando campos editoriais/contextuais nao existem, mas depois da migration eles podem permanecer sem uso.

Opcionalmente, pausar leitura editorial global no codigo e manter somente persistencia basica.

### Evitar

Nao executar sem decisao explicita:

```sql
alter table public.user_title_feedback drop column ...
alter table public.user_title_state drop column ...
delete from public.user_title_feedback ...
truncate public.user_events ...
```

## Riscos Restantes

- RLS/policies precisam ser conferidas depois da aplicacao.
- O endpoint real precisa ser testado com sessao autenticada.
- A constraint unica atual ainda limita um feedback por tipo/titulo; multiplos dismissals por section exigem etapa posterior.
- `favorite` ainda nao deve escrever em `user_titles` ate o rollout estar estabilizado.
- Hooks/UI ainda nao devem ser migrados antes do smoke test controlado.
