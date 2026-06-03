/**
 * db:backup — Backup completo do MySQL local via mysqldump no container Docker.
 *
 * Gera: backups/poplog-mysql-backup-YYYY-MM-DD-HH-mm.sql
 *
 * Pré-requisitos:
 *   - Docker Desktop instalado e rodando
 *   - Container MySQL em execução (ver BACKUP_RESTORE.md)
 *
 * Variáveis de ambiente usadas:
 *   DATABASE_URL              — mysql://user:pass@host:port/database
 *   MYSQL_DOCKER_CONTAINER    — nome do container (padrão: poplog-mysql)
 *
 * Uso:
 *   npm run db:backup
 *
 * O arquivo SQL gerado é um dump completo (schema + dados + timestamps originais).
 * Use db:restore para restaurar. Use db:export/import para portabilidade em JSON.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────

function parseDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      host: parsed.hostname,
      port: parsed.port || "3306",
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

function padded(n: number): string {
  return String(n).padStart(2, "0");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[db:backup] DATABASE_URL não definida.");
    process.exit(1);
  }

  const db = parseDatabaseUrl(databaseUrl);
  if (!db || !db.database) {
    console.error("[db:backup] Não foi possível parsear DATABASE_URL:", databaseUrl);
    process.exit(1);
  }

  const container = (process.env.MYSQL_DOCKER_CONTAINER ?? "poplog-mysql").trim();

  // Verificar se Docker está disponível
  const dockerCheck = spawnSync("docker", ["info"], { encoding: "utf-8" });
  if (dockerCheck.status !== 0) {
    console.error(
      "[db:backup] Docker não está disponível ou não está rodando.\n" +
        "           Inicie o Docker Desktop e tente novamente.",
    );
    process.exit(1);
  }

  // Verificar se o container existe e está rodando
  const containerCheck = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", container],
    { encoding: "utf-8" },
  );
  if (containerCheck.status !== 0 || containerCheck.stdout.trim() !== "true") {
    console.error(
      `[db:backup] Container "${container}" não encontrado ou não está rodando.\n\n` +
        `  Dica: verifique MYSQL_DOCKER_CONTAINER no .env.local\n` +
        `  Containers ativos: docker ps --format "table {{.Names}}"\n`,
    );
    process.exit(1);
  }

  const now = new Date();
  const ts = [
    now.getFullYear(),
    padded(now.getMonth() + 1),
    padded(now.getDate()),
    padded(now.getHours()),
    padded(now.getMinutes()),
  ].join("-");

  const filename = `poplog-mysql-backup-${ts}.sql`;
  const outputDir = path.resolve("backups");
  const outputPath = path.join(outputDir, filename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`[db:backup] Container : ${container}`);
  console.log(`[db:backup] Banco     : ${db.database}`);
  console.log(`[db:backup] Destino   : ${outputPath}`);
  console.log(`[db:backup] Executando mysqldump...\n`);

  // Nota: -p<password> sem espaço é obrigatório para mysqldump
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "mysqldump",
      "--single-transaction",
      "--routines",
      "--triggers",
      `--user=${db.user}`,
      `--password=${db.password}`,
      db.database,
    ],
    {
      maxBuffer: 512 * 1024 * 1024, // 512 MB
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    console.error("[db:backup] Falha no mysqldump:\n", stderr);
    process.exit(1);
  }

  if (!result.stdout || result.stdout.length === 0) {
    console.error("[db:backup] mysqldump retornou saída vazia. Verifique o container.");
    process.exit(1);
  }

  fs.writeFileSync(outputPath, result.stdout);

  const sizeKb = Math.round(result.stdout.length / 1024);
  console.log(`[db:backup] Backup concluído.`);
  console.log(`[db:backup] Arquivo : ${outputPath}`);
  console.log(`[db:backup] Tamanho : ${sizeKb} KB`);
  console.log(`\n  Para restaurar: npm run db:restore -- --yes --file ${outputPath}\n`);
}

main().catch((err) => {
  console.error("[db:backup] Erro fatal:", err);
  process.exitCode = 1;
});
