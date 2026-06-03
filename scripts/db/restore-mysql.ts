/**
 * db:restore — Restaura o banco MySQL local a partir de um dump SQL gerado por db:backup.
 *
 * ATENÇÃO: operação DESTRUTIVA. Apaga e recria todo o banco.
 *          Exige confirmação explícita com --yes.
 *
 * Pré-requisitos:
 *   - Docker Desktop instalado e rodando
 *   - Container MySQL em execução
 *   - Arquivo .sql gerado por npm run db:backup
 *
 * Variáveis de ambiente usadas:
 *   DATABASE_URL              — mysql://user:pass@host:port/database
 *   MYSQL_DOCKER_CONTAINER    — nome do container (padrão: poplog-mysql)
 *
 * Uso:
 *   npm run db:restore -- --yes
 *   npm run db:restore -- --yes --file backups/poplog-mysql-backup-2026-06-03-10-00.sql
 *
 * O restore preserva timestamps originais (diferente do db:import que reseta @updatedAt).
 * Após restore, rode: npm run db:generate  para regenerar o Prisma Client se necessário.
 */

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const isConfirmed = argv.includes("--yes") || argv.includes("-y");

const fileArgIndex = argv.findIndex((a) => a === "--file" || a === "-f");
const fileArgValue =
  fileArgIndex !== -1 ? argv[fileArgIndex + 1] : argv.find((a) => !a.startsWith("-"));

// ── Config ────────────────────────────────────────────────────────────────────

function parseDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

// ── File resolution ───────────────────────────────────────────────────────────

function findLatestBackup(): string | null {
  const dir = path.resolve("backups");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("poplog-mysql-backup-") && f.endsWith(".sql"))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

function resolveFile(): string {
  if (fileArgValue) {
    const abs = path.resolve(fileArgValue);
    if (!fs.existsSync(abs)) {
      console.error(`[db:restore] Arquivo não encontrado: ${abs}`);
      process.exit(1);
    }
    return abs;
  }
  const latest = findLatestBackup();
  if (!latest) {
    console.error(
      "[db:restore] Nenhum backup encontrado em backups/.\n" +
        "             Execute npm run db:backup primeiro.",
    );
    process.exit(1);
  }
  return latest;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!isConfirmed) {
    console.error(
      "\n[db:restore] ATENÇÃO: esta operação APAGA e RESTAURA todo o banco de dados.\n\n" +
        "  Esta ação é irreversível sem outro backup.\n\n" +
        "  Para confirmar, passe --yes:\n\n" +
        "    npm run db:restore -- --yes\n" +
        "    npm run db:restore -- --yes --file backups/poplog-mysql-backup-....sql\n",
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[db:restore] DATABASE_URL não definida.");
    process.exit(1);
  }

  const db = parseDatabaseUrl(databaseUrl);
  if (!db || !db.database) {
    console.error("[db:restore] Não foi possível parsear DATABASE_URL:", databaseUrl);
    process.exit(1);
  }

  const container = (process.env.MYSQL_DOCKER_CONTAINER ?? "poplog-v3-mysql").trim();

  // Verificar se Docker está disponível
  const dockerCheck = spawnSync("docker", ["info"], { encoding: "utf-8" });
  if (dockerCheck.status !== 0) {
    console.error(
      "[db:restore] Docker não está disponível ou não está rodando.\n" +
        "             Inicie o Docker Desktop e tente novamente.",
    );
    process.exit(1);
  }

  // Verificar se o container está rodando
  const containerCheck = spawnSync(
    "docker",
    ["inspect", "--format", "{{.State.Running}}", container],
    { encoding: "utf-8" },
  );
  if (containerCheck.status !== 0 || containerCheck.stdout.trim() !== "true") {
    console.error(
      `[db:restore] Container "${container}" não encontrado ou não está rodando.\n\n` +
        `  Dica: verifique MYSQL_DOCKER_CONTAINER no .env.local\n`,
    );
    process.exit(1);
  }

  const filePath = resolveFile();
  const sqlContent = fs.readFileSync(filePath);
  const sizeKb = Math.round(sqlContent.length / 1024);

  console.log(`[db:restore] Container : ${container}`);
  console.log(`[db:restore] Banco     : ${db.database}`);
  console.log(`[db:restore] Arquivo   : ${filePath}`);
  console.log(`[db:restore] Tamanho   : ${sizeKb} KB`);
  console.log(`[db:restore] Restaurando...\n`);

  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "mysql",
      `--user=${db.user}`,
      `--password=${db.password}`,
      db.database,
    ],
    {
      input: sqlContent,
      maxBuffer: 512 * 1024 * 1024, // 512 MB
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    console.error("[db:restore] Falha no restore:\n", stderr);
    process.exit(1);
  }

  const warnings = result.stderr?.toString() ?? "";
  if (warnings && !warnings.includes("Warning: Using a password on the command line")) {
    console.warn("[db:restore] Avisos do MySQL:\n", warnings);
  }

  console.log("[db:restore] Restore concluído com sucesso.");
  console.log(`[db:restore] Banco "${db.database}" restaurado a partir de:`);
  console.log(`             ${filePath}\n`);
  console.log("  Próximos passos:");
  console.log("    npm run db:generate   # regenerar Prisma Client se necessário");
  console.log("    npm run db:smoke      # validar integridade básica\n");
}

main().catch((err) => {
  console.error("[db:restore] Erro fatal:", err);
  process.exitCode = 1;
});
