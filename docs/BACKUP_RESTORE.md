# POPLOG v3 — Backup e Restore MySQL (SQL Dump)

> Backup e restore completo do banco via `mysqldump` no container Docker.
> Para exportar/importar dados em JSON, use [DATABASE_EXPORT_IMPORT.md](./DATABASE_EXPORT_IMPORT.md).

---

## Diferença: SQL backup vs JSON export

| | SQL backup (`db:backup`) | JSON export (`db:export`) |
|---|---|---|
| **Formato** | SQL puro (mysqldump) | JSON app-level |
| **Timestamps** | Preservados exatamente | `@updatedAt` resetado no import |
| **Conteúdo** | Banco completo (todas as tabelas) | Tabelas selecionadas |
| **Uso** | Disaster recovery, reset completo | Migração, portabilidade, seed |
| **Dependência** | Docker + MySQL client no container | Apenas Prisma / Node.js |

---

## Pré-requisitos

- Docker Desktop instalado e rodando
- Container MySQL em execução (ver [LOCAL_FULL_MODE.md](./LOCAL_FULL_MODE.md))
- `mysqldump` disponível dentro do container (padrão em imagens MySQL oficiais)

---

## Variáveis de ambiente

```env
# URL do banco (usado para extrair credenciais)
DATABASE_URL=mysql://poplog:poplog_local_password@localhost:3306/poplog_v3

# Nome do container Docker (padrão: poplog-v3-mysql — conforme docker-compose.yml)
MYSQL_DOCKER_CONTAINER=poplog-v3-mysql
```

---

## Como fazer backup

```bash
npm run db:backup
```

Gera: `backups/poplog-mysql-backup-YYYY-MM-DD-HH-mm.sql`

O script:
1. Verifica se Docker está rodando
2. Verifica se o container MySQL está ativo
3. Executa `mysqldump --single-transaction --routines --triggers` dentro do container
4. Salva o output em `backups/`

### Exemplo de saída

```
[db:backup] Container : poplog-v3-mysql
[db:backup] Banco     : poplog_v3
[db:backup] Destino   : D:\projects\poplog-v3\backups\poplog-mysql-backup-2026-06-03-10-00.sql
[db:backup] Executando mysqldump...

[db:backup] Backup concluído.
[db:backup] Arquivo : backups\poplog-mysql-backup-2026-06-03-10-00.sql
[db:backup] Tamanho : 1234 KB

  Para restaurar: npm run db:restore -- --yes --file backups\poplog-mysql-backup-2026-06-03-10-00.sql
```

---

## Como restaurar

**ATENÇÃO: operação DESTRUTIVA. Apaga e recria todo o banco.**

```bash
# Usar o backup mais recente em backups/
npm run db:restore -- --yes

# Especificar arquivo
npm run db:restore -- --yes --file backups/poplog-mysql-backup-2026-06-03-10-00.sql
```

O script:
1. Verifica `--yes` (proteção contra execução acidental)
2. Verifica Docker e container
3. Executa `mysql` dentro do container com o arquivo SQL como stdin
4. Relata sucesso ou erro

### Após o restore

```bash
# Se o schema do Prisma foi alterado desde o backup:
npm run db:generate

# Validar integridade básica:
npm run db:smoke
```

---

## Container Docker

### Setup padrão (docker-compose)

```bash
docker compose up -d
```

### Setup manual (caso não tenha docker-compose)

```bash
docker run -d \
  --name poplog-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=poplog_v3 \
  -e MYSQL_USER=poplog \
  -e MYSQL_PASSWORD=poplog_local_password \
  -p 3306:3306 \
  mysql:8.0
```

### Containers múltiplos

Se você tiver múltiplos containers MySQL rodando, defina `MYSQL_DOCKER_CONTAINER` no `.env.local`:

```env
MYSQL_DOCKER_CONTAINER=poplog-v3-mysql
```

Para listar containers ativos:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

---

## Alternativa: mysqldump diretamente (sem npm)

Se o `npx tsx` não estiver disponível, execute o dump manualmente:

```bash
# Backup manual (container default: poplog-v3-mysql)
docker exec poplog-v3-mysql \
  mysqldump --single-transaction -upoplog -ppoplog_local_password poplog_v3 \
  > backups/backup-manual.sql

# Restore manual
docker exec -i poplog-v3-mysql \
  mysql -upoplog -ppoplog_local_password poplog_v3 \
  < backups/backup-manual.sql
```

---

## Limitações conhecidas

- **Buffer**: o script usa buffer em memória (512 MB máx). Para bancos muito grandes, use o mysqldump direto com redirecionamento de arquivo.
- **Senha em argumento**: o mysqldump emite um aviso sobre senha em linha de comando. É esperado em ambiente local de desenvolvimento.
- **Schema vs dados**: o dump inclui schema + dados. Se o schema do Prisma foi alterado depois do backup, pode ser necessário fazer `prisma migrate` antes de restaurar.
- **Ambientes**: os backups são para o banco local de desenvolvimento. Não use para produção.

---

## Pasta `backups/`

A pasta `backups/` está no `.gitignore` — os arquivos não são versionados. Copie backups importantes para local seguro (HD externo, cloud storage) antes de operações destrutivas.

---

## Ver também

- [DATABASE_EXPORT_IMPORT.md](./DATABASE_EXPORT_IMPORT.md) — export/import JSON app-level
- [DEPLOY_HOSTINGER.md](./DEPLOY_HOSTINGER.md) — guia de deploy e migração de dados para Hostinger
- [HOSTINGER_CHECKLIST.md](./HOSTINGER_CHECKLIST.md) — checklist pré-deploy
