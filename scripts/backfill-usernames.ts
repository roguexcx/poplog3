/**
 * Backfill: preenche users.username para usuários sem slug de rota.
 *
 * Deriva o username de email (parte antes do @), com fallback para name ou
 * um identificador estável (user-<id8>). Normaliza para [a-z0-9-] e garante
 * unicidade global com sufixo numérico em caso de colisão.
 *
 * Idempotente: usuários que já possuem username são ignorados.
 *
 * Uso:
 *   npx tsx scripts/backfill-usernames.ts            # aplica
 *   npx tsx scripts/backfill-usernames.ts --dry-run  # apenas relatório
 *
 * Requer: DATABASE_URL no .env (ou .env.local)
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const DRY_RUN = process.argv.includes("--dry-run");

const MAX_USERNAME_LENGTH = 64;
let disconnectDb: (() => Promise<void>) | null = null;

/** Normaliza um candidato para o formato de username: [a-z0-9-], minúsculo. */
function normalize(candidate: string): string {
  const slug = candidate
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, "") // apara hífens nas pontas
    .replace(/-{2,}/g, "-"); // colapsa hífens repetidos

  return slug.slice(0, MAX_USERNAME_LENGTH);
}

/** Deriva o candidato base a partir de email/name/id. */
function deriveBase(user: { id: string; email: string | null; name: string | null }): string {
  const fromEmail = user.email ? normalize(user.email.split("@")[0] ?? "") : "";
  if (fromEmail) return fromEmail;

  const fromName = user.name ? normalize(user.name) : "";
  if (fromName) return fromName;

  return `user-${user.id.slice(0, 8).toLowerCase()}`;
}

/** Garante unicidade adicionando sufixo numérico (-2, -3, ...) quando preciso. */
function makeUnique(base: string, taken: Set<string>): string {
  const safeBase = base || "user";
  const safeKey = safeBase.toLowerCase();
  if (!taken.has(safeKey)) {
    taken.add(safeKey);
    return safeBase;
  }

  let suffix = 2;
  // reserva espaço para o sufixo dentro do limite de tamanho
  while (true) {
    const tail = `-${suffix}`;
    const trimmed = safeBase.slice(0, MAX_USERNAME_LENGTH - tail.length);
    const candidate = `${trimmed}${tail}`;
    const candidateKey = candidate.toLowerCase();
    if (!taken.has(candidateKey)) {
      taken.add(candidateKey);
      return candidate;
    }
    suffix += 1;
  }
}

async function main() {
  const { db } = await import("@/server/db/client");
  disconnectDb = () => db.$disconnect();

  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, username: true },
    orderBy: { createdAt: "asc" },
  });

  // Conjunto de usernames já em uso (não-nulos) para evitar colisões.
  const taken = new Set<string>(
    users
      .map((u) => u.username)
      .filter((u): u is string => Boolean(u))
      .map((u) => u.toLowerCase()),
  );

  const pending = users.filter((u) => !u.username);

  console.log(`[backfill-usernames] total=${users.length} já_com_username=${taken.size} pendentes=${pending.length}`);

  if (pending.length === 0) {
    console.log("[backfill-usernames] nada a fazer.");
    return;
  }

  let applied = 0;
  for (const user of pending) {
    const username = makeUnique(deriveBase(user), taken);

    if (DRY_RUN) {
      console.log(`[dry-run] ${user.id} → ${username}`);
      continue;
    }

    await db.user.update({ where: { id: user.id }, data: { username } });
    applied += 1;
    console.log(`[ok] ${user.id} → ${username}`);
  }

  console.log(
    DRY_RUN
      ? `[backfill-usernames] dry-run concluído (${pending.length} seriam atualizados).`
      : `[backfill-usernames] concluído: ${applied} usuários atualizados.`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill-usernames] falhou:", error);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDb?.();
  });
