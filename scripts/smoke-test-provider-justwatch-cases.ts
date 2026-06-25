import { db } from "@/server/db/client";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function main() {
  const imdbId = process.env.PROVIDER_SMOKE_IMDB_ID ?? "tt0993846";
  const region = process.env.PROVIDER_SMOKE_REGION ?? "BR";
  const language = process.env.PROVIDER_SMOKE_LANGUAGE ?? "pt-BR";

  const rows = await db.catalogAvailability.findMany({
    where: {
      imdbId,
      providerRegion: region,
      providerLanguage: language,
      source: "justwatch",
    },
    orderBy: [{ providerType: "asc" }, { providerName: "asc" }],
  });

  assert(rows.length > 0, `No JustWatch availability rows for ${imdbId}/${region}/${language}`);

  const diamond = rows.find((row) => /diamond films amazon channel/i.test(row.providerName));
  assert(diamond, "Diamond Films Amazon Channel row not found");
  assert(diamond?.providerType === "subscription", "Diamond Films should be normalized as subscription/channel access");
  assert(rawObject(diamond?.rawPayloadJson)?.accessKind === "partner_channel", "Diamond raw payload should preserve partner_channel");

  const rentRows = rows.filter((row) => row.providerType === "rent");
  assert(rentRows.length > 0, "No rent offers found");
  assert(rentRows.some((row) => rawObject(row.rawPayloadJson)), "Rent offers should preserve rawPayloadJson");

  const categories = Array.from(new Set(rows.map((row) => row.providerType))).sort();
  const sourceRows = rows.filter((row) => row.source === "justwatch").length;

  console.log("[provider-justwatch-smoke] ok", {
    imdbId,
    region,
    language,
    rows: rows.length,
    sourceRows,
    categories,
    providers: rows.map((row) => `${row.providerName}:${row.providerType}`).slice(0, 12),
  });
}

main()
  .catch((error) => {
    console.error("[provider-justwatch-smoke] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
