# POPLOG v3 — Guia de Deploy Hostinger

> **Status**: documentação atualizada (Fase 13D+). Supabase removido completamente.
> Auth.js com Google OAuth e MySQL/Prisma são o stack de produção.

---

## Visão geral

O POPLOG v3 roda como uma aplicação Next.js 16 com banco MySQL via Prisma.
No Hostinger, a estratégia recomendada é:

```
Hostinger VPS (Node.js 20+)
  ├── App Next.js 16 gerenciado pelo PM2
  ├── MySQL gerenciado pelo painel Hostinger (ou na própria VPS)
  └── Build: npm run build → npm run start
```

O banco local Docker é substituído pelo MySQL do Hostinger.
Todos os módulos locais ficam ativos (`POPLOG_LOCAL_DB_ENABLED=true`).
Auth local (`POPLOG_LOCAL_AUTH_ENABLED`) fica **desligada** — auth em produção é feita via Auth.js com Google OAuth.

---

## Pré-requisitos Hostinger

### Plano recomendado

| Recurso | Mínimo | Recomendado |
|---|---|---|
| Node.js | 20.x | 22.x |
| RAM | 1 GB | 2 GB+ |
| CPU | 1 vCore | 2 vCores |
| MySQL | 5.7+ | 8.0+ |
| Disco | 10 GB | 20 GB+ |

**Hostinger VPS KVM 2** (ou superior) é o plano que satisfaz esses requisitos.
Planos de shared hosting têm suporte limitado ao Node.js e podem não suportar Next.js 16 standalone.

### Software necessário na VPS

```bash
# Node.js 20+ (via nvm recomendado)
nvm install 20
nvm use 20

# PM2 para gerenciamento de processos
npm install -g pm2

# Git para deploy
git --version
```

---

## 1 — Banco MySQL no Hostinger

### Criar o banco via painel Hostinger

1. Acesse o painel hPanel → **Databases** → **MySQL Databases**
2. Crie um novo banco: `poplog_v3_prod` (ou o nome desejado)
3. Crie um usuário e associe ao banco com **todas as permissões**
4. Anote: host, porta, usuário, senha, nome do banco

### String de conexão

```env
DATABASE_URL="mysql://HOSTINGER_DB_USER:HOSTINGER_DB_PASS@HOSTINGER_DB_HOST:3306/HOSTINGER_DB_NAME"
```

> O host MySQL do Hostinger normalmente é `localhost` para planos shared
> ou um hostname dedicado (ex: `mysql.srv123.hostinger.com`) em VPS.
> Confirme no painel hPanel → Databases → Connection details.

### Aplicar o schema Prisma

Após configurar `DATABASE_URL`, aplique o schema no banco de produção:

```bash
# Opção A — migrate deploy (recomendado; requer migrations criadas)
npx prisma migrate deploy

# Opção B — db push (sem histórico de migrations)
npx prisma db push
```

**Recomendação**: antes de ir para produção, garantir que as migrations existem:
```bash
# Uma única vez, no ambiente local (com banco limpo):
npx prisma migrate dev --name init
# Isso cria prisma/migrations/ — commitar e usar migrate deploy em prod
```

Ver detalhes em [HOSTINGER_ENV.md](./HOSTINGER_ENV.md#prisma-em-produção).

---

## 2 — Variáveis de ambiente de produção

Criar o arquivo `.env.production` ou configurar via painel da VPS/Hostinger.
**Nunca commitar este arquivo.**

Referência completa: [HOSTINGER_ENV.md](./HOSTINGER_ENV.md)

Resumo das variáveis críticas:

```env
# Banco MySQL Hostinger
DATABASE_URL="mysql://user:pass@host:3306/database"

# Master switch: todos os módulos locais ativos
POPLOG_LOCAL_DB_ENABLED=true

# Auth local: DESLIGADA em produção
POPLOG_LOCAL_AUTH_ENABLED=false

# Auth.js com Google OAuth (obrigatório em produção)
AUTH_SECRET=seu_secret_gerado_com_npx_auth_secret
AUTH_GOOGLE_ID=seu_google_client_id
AUTH_GOOGLE_SECRET=seu_google_client_secret

# Admin
ADMIN_SECRET=seu_segredo_admin

# APIs externas
TMDB_API_KEY=sua_chave_tmdb
OMDB_API_KEY=sua_chave_omdb
WATCHMODE_API_KEY=sua_chave_watchmode

NODE_ENV=production
```

---

## 3 — Deploy do código

### Via Git (recomendado)

```bash
# Na VPS Hostinger, primeira vez:
git clone https://github.com/seu-usuario/poplog-v3.git /var/www/poplog-v3
cd /var/www/poplog-v3

# Configurar .env (nunca commitar)
cp docs/HOSTINGER_ENV.md /tmp/env-reference.md
nano .env  # preencher com valores reais

# Instalar dependências (inclui devDependencies para o build)
npm install

# Gerar Prisma Client
npm run db:generate

# Aplicar schema no banco Hostinger
npx prisma migrate deploy
# ou: npx prisma db push (se migrations ainda não existirem)

# Build
npm run build

# Iniciar com PM2
pm2 start npm --name "poplog-v3" -- start
pm2 save
pm2 startup  # configurar autostart
```

### Atualizar o deploy (após mudanças)

```bash
cd /var/www/poplog-v3
git pull origin main
npm install
npm run db:generate
npx prisma migrate deploy   # só se o schema mudou
npm run build
pm2 reload poplog-v3
```

---

## 4 — Migração de dados local → Hostinger

Duas opções, conforme o volume de dados:

### Opção A — JSON export/import (simples, recomendada para dados pequenos/médios)

```bash
# 1. Local: exportar dados
npm run db:export
# Gera: exports/poplog-export-YYYY-MM-DD-HH-mm.json

# 2. Transferir para a VPS
scp exports/poplog-export-2026-06-03-11-46.json \
    usuario@hostinger-vps:/var/www/poplog-v3/exports/

# 3. Na VPS: importar (com DATABASE_URL apontando para Hostinger)
npm run db:import -- --file exports/poplog-export-2026-06-03-11-46.json
```

**Atenção**: `@updatedAt` será resetado para o momento do import. Para timestamps
exatos, use a Opção B. Ver [DATABASE_EXPORT_IMPORT.md](./DATABASE_EXPORT_IMPORT.md#limitação-conhecida-updatedat).

### Opção B — SQL dump via phpMyAdmin (completo, timestamps preservados)

```bash
# 1. Local: gerar dump do banco Docker
npm run db:backup
# Gera: backups/poplog-mysql-backup-YYYY-MM-DD-HH-mm.sql

# 2. Importar via phpMyAdmin do Hostinger
#    hPanel → Databases → phpMyAdmin → selecionar banco → Import → Upload .sql
```

Ou via CLI na VPS (se acesso SSH ao MySQL):
```bash
mysql -u hostinger_user -p hostinger_db < poplog-mysql-backup-2026-06-03-10-00.sql
```

---

## 5 — Verificação pós-deploy

```bash
# Na VPS, com DATABASE_URL do Hostinger:
npm run db:smoke         # smoke de repositories
npm run db:smoke:services  # smoke de services

# Verificar logs do PM2
pm2 logs poplog-v3 --lines 50

# Verificar app
curl http://localhost:3000/api/health   # se existir
```

---

## 6 — Auth em produção

Em produção, a autenticação usa Auth.js com Google OAuth:
- `POPLOG_LOCAL_AUTH_ENABLED=false` — obrigatório
- `AUTH_SECRET`, `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` devem ser configurados
- O login de usuários passa pelo fluxo OAuth Google → Auth.js → sessão no MySQL via Prisma
- Os dados (biblioteca, títulos, etc.) ficam no MySQL Hostinger

Para configurar o Google OAuth:
1. Acesse o Google Cloud Console → APIs & Services → Credentials
2. Crie um OAuth 2.0 Client ID (tipo: Web application)
3. Adicione o callback de produção: `https://seu-dominio.com/api/auth/callback/google`
4. Copie o Client ID e Client Secret para `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET`

Ver detalhes em [AUTH_JS_SETUP.md](./AUTH_JS_SETUP.md).

---

## 7 — PM2 — configuração recomendada

Criar `ecosystem.config.js` na raiz do projeto (não commitar com credentials):

```javascript
module.exports = {
  apps: [{
    name: 'poplog-v3',
    script: 'node_modules/.bin/next',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '512M',
    instances: 1,
    exec_mode: 'fork',
  }]
}
```

```bash
pm2 start ecosystem.config.js
```

> Para carregar variáveis de ambiente, use `.env` na raiz ou export manual antes do pm2 start.

---

## Riscos e limitações

Ver seção completa em [HOSTINGER_CHECKLIST.md](./HOSTINGER_CHECKLIST.md#riscos).

Resumo:
- Suporte a Next.js 16 varia por plano Hostinger
- MySQL connection pool pode exigir ajustes de `DATABASE_URL`
- Usar `npx prisma migrate deploy` em produção para garantir histórico de migrations
- Logs centralizados via PM2 (sem observabilidade avançada por ora)
- Uploads/storage não implementados no app ainda
