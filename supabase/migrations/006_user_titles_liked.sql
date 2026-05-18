-- Migration 006: adiciona coluna liked em user_titles
-- Necessária para a migração Option B: user_titles como fonte de estado única.
-- A coluna já existe em poplog3_user_titles e precisa existir aqui
-- para que fetchLibraryEntry e upsertUserTitleStatus operem corretamente.

alter table user_titles
  add column if not exists liked boolean;
