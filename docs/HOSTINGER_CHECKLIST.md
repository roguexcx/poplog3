# POPLOG v3 — Checklist de Deploy Hostinger

> Use este checklist antes de qualquer deploy no Hostinger.
> Stack de produção: MySQL/Prisma + Auth.js/Google OAuth. Supabase foi removido na Fase 13D.

---

## Checklist pré-deploy

### 1 — Ambiente local OK

- [ ] `npm run build` termina sem erros
- [ ] `npx tsc --noEmit` passa sem erros de tipagem
- [ ] `npm run db:smoke` passa (smoke de repositories)
- [ ] `npm run db:smoke:services` passa
- [ ] `npm run db:smoke:local-full` passa (43+ assertions)
- [ ] `npm run db:smoke:export-import` passa (55+ assertions)
- [ ] App rodando localmente em modo full (`POPLOG_LOCAL_DB_ENABLED=true`)
- [ ] Login e fluxo de usuário funcionando localmente

---

### 2 — Backup antes de qualquer ação destrutiva

- [ ] Export JSON recente gerado: `npm run db:export`
- [ ] Arquivo de export salvo em local seguro (fora do repo)
- [ ] Backup SQL gerado: `npm run db:backup`
- [ ] Arquivo SQL salvo em local seguro
- [ ] Backup do banco de produção feito (se existir)

---

### 3 — Banco MySQL Hostinger

- [ ] Banco criado no painel hPanel → Databases
- [ ] Usuário MySQL criado com permissões completas (ALL PRIVILEGES)
- [ ] `DATABASE_URL` testada: `mysql://USER:PASS@HOST:3306/DATABASE`
- [ ] Conexão verificada: `npx prisma db pull` (ou `db push --dry-run` se disponível)
- [ ] Schema aplicado: `npx prisma migrate deploy` (ou `npx prisma db push`)
- [ ] `npx prisma generate` executado após schema aplicado

---

### 4 — Variáveis de ambiente

- [ ] `DATABASE_URL` aponta para Hostinger (não para `localhost:3306`)
- [ ] `POPLOG_LOCAL_DB_ENABLED=true`
- [ ] `POPLOG_LOCAL_AUTH_ENABLED=false` (nunca `true` em produção)
- [ ] `LOCAL_USER_ID` **não** definido (remover do `.env` de prod)
- [ ] `AUTH_SECRET` definido e válido (gerado com `npx auth secret`)
- [ ] `AUTH_GOOGLE_ID` definido e válido
- [ ] `AUTH_GOOGLE_SECRET` definido e válido
- [ ] `ADMIN_SECRET` definido e válido
- [ ] `TMDB_API_KEY` definido e válido
- [ ] `OMDB_API_KEY` definido (ou módulo omdb desabilitado)
- [ ] `WATCHMODE_API_KEY` definido (ou módulo watchmode desabilitado)
- [ ] `NODE_ENV=production`
- [ ] Arquivo `.env` **não** commitado no git
- [ ] Variáveis Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) **não** presentes no `.env` de produção

---

### 5 — Build e start

- [ ] `npm install` executado (incluindo devDependencies para o build)
- [ ] `npm run db:generate` executado
- [ ] `npm run build` termina sem erros no servidor Hostinger
- [ ] `npm run start` (ou PM2) inicia sem erros
- [ ] Porta correta configurada (padrão: 3000)

---

### 6 — Migração de dados (se necessário)

- [ ] Arquivo de export ou SQL dump transferido para a VPS
- [ ] Import executado: `npm run db:import` ou via phpMyAdmin
- [ ] Contagens de linhas verificadas após import
- [ ] Usuários importados com IDs corretos

---

### 7 — Domínio e SSL

- [ ] Domínio apontando para o IP da VPS
- [ ] SSL/TLS configurado (Let's Encrypt via Certbot ou painel Hostinger)
- [ ] HTTPS ativo e redirecionando HTTP → HTTPS
- [ ] Callback Google OAuth atualizado para o domínio de produção: `https://seu-dominio.com/api/auth/callback/google`
- [ ] `AUTH_URL` configurado com a URL de produção (se necessário)

---

### 8 — Verificação pós-deploy

- [ ] App acessível via HTTPS no domínio
- [ ] Login com Google OAuth funcionando (Auth.js)
- [ ] Sessão persistida corretamente após login
- [ ] Página `/library` carrega dados do MySQL Hostinger
- [ ] Página `/acompanhando` funciona
- [ ] Hero Spotlight carrega corretamente
- [ ] Smokes básicos passando no servidor: `npm run db:smoke`
- [ ] PM2 reinicia automaticamente após reboot: `pm2 startup && pm2 save`
- [ ] Logs sem erros críticos: `pm2 logs poplog-v3 --lines 100`

---

## Riscos

### Suporte Next.js no Hostinger

| Risco | Nível | Mitigação |
|---|---|---|
| Shared hosting sem suporte a Next.js 16 | Alto | Usar VPS (KVM 2+) com Node.js 20 |
| Node.js version desatualizada na VPS | Médio | Instalar via nvm; verificar `node -v` antes do build |
| Porta 3000 bloqueada por firewall | Médio | Configurar nginx como proxy reverso na porta 80/443 |
| PM2 não configurado para autostart | Médio | Executar `pm2 startup` + `pm2 save` |

### MySQL e Prisma

| Risco | Nível | Mitigação |
|---|---|---|
| Sem `prisma/migrations/` criadas | Médio | `db push` cuidadoso; backups antes de cada push |
| `db push` destrutivo em renomear colunas | Alto | Fazer backup SQL antes de qualquer mudança de schema |
| Pool de conexões esgotado | Médio | Adicionar `?connection_limit=5` na `DATABASE_URL` |
| Charset/collation MySQL divergente | Baixo | Usar `utf8mb4_unicode_ci` (padrão Prisma para MySQL) |
| Host MySQL não acessível remotamente | Médio | Verificar se o Hostinger permite conexão externa (geralmente não em shared) |

### Auth.js e Google OAuth

| Risco | Nível | Mitigação |
|---|---|---|
| `POPLOG_LOCAL_AUTH_ENABLED=true` em prod | Crítico | Verificar `.env` antes do deploy; CI/CD deve bloquear |
| `AUTH_SECRET` ausente ou inválido | Crítico | Verificar antes do deploy; gerar com `npx auth secret` |
| Callback Google OAuth com URL errada | Alto | Adicionar URL de produção no Google Cloud Console antes do go-live |
| Sessões inválidas após rotação de `AUTH_SECRET` | Médio | Avisar usuários; sessões antigas serão invalidadas |

### Dados e backup

| Risco | Nível | Mitigação |
|---|---|---|
| Sem backup antes de `db push` em prod | Alto | Item obrigatório no checklist |
| Export JSON perde `@updatedAt` | Baixo | Usar SQL dump para timestamps exatos |
| `backups/` e `exports/` não versionados | Médio | Salvar em storage externo (S3, Google Drive, etc.) |
| Banco limpo após rebuild da VPS | Alto | Manter backup SQL fora da VPS |

### Performance

| Risco | Nível | Mitigação |
|---|---|---|
| Cold start lento em VPS com pouca RAM | Médio | PM2 cluster mode ou aumentar plano |
| `tmdb_payload` (JSON grande) lentifica queries | Baixo | Índice em `tmdbId` + `mediaType` já existe no schema |
| Muitas conexões Prisma em rotas Next.js | Médio | Usar singleton do PrismaClient (`src/server/db/client.ts`) |

---

## Referências

- [DEPLOY_HOSTINGER.md](./DEPLOY_HOSTINGER.md) — guia completo de deploy
- [HOSTINGER_ENV.md](./HOSTINGER_ENV.md) — referência de variáveis
- [AUTH_JS_SETUP.md](./AUTH_JS_SETUP.md) — configuração do Auth.js
- [DATABASE_EXPORT_IMPORT.md](./DATABASE_EXPORT_IMPORT.md) — export/import de dados
- [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) — backup/restore SQL
- [LOCAL_FULL_MODE.md](./LOCAL_FULL_MODE.md) — modo local completo
