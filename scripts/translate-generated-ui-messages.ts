import fs from "node:fs";
import path from "node:path";

type Catalog = Record<string, { "pt-BR": string; "en-US": string }>;

const CATALOG_PATH = path.join(process.cwd(), "src/lib/i18n/generated-ui-messages.json");
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;

function protect(text: string): { text: string; placeholders: string[] } {
  const placeholders: string[] = [];
  return {
    text: text.replace(PLACEHOLDER_RE, (match) => {
      const token = `__POPLOG_PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(match);
      return token;
    }),
    placeholders,
  };
}

function restore(text: string, placeholders: string[]): string {
  return placeholders.reduce(
    (acc, value, index) =>
      acc
        .replaceAll(`__POPLOG_PLACEHOLDER_${index}__`, value)
        .replaceAll(`__ POPLOG_PLACEHOLDER_${index} __`, value)
        .replaceAll(`__Poplog_Placeholder_${index}__`, value),
    text,
  );
}

function shouldTranslate(pt: string, en: string): boolean {
  if (pt !== en) return false;
  const clean = pt.replace(PLACEHOLDER_RE, "").replaceAll("&quot;", "\"").trim();
  if (!/[A-Za-zÀ-ÿ]/.test(clean)) return false;
  if (/^[A-Z0-9 %·:._/#&+-]+$/.test(clean)) return false;
  return true;
}

async function translateText(translate: (text: string, options: { from: string; to: string }) => Promise<{ text: string }>, pt: string) {
  const { text, placeholders } = protect(pt.replaceAll("&quot;", "\""));
  const translated = await translate(text, { from: "pt", to: "en" });
  return restore(translated.text, placeholders).replaceAll("\"", "&quot;");
}

async function main() {
  const mod = await import("google-translate-api-x");
  const translate = (mod.default ?? mod.translate) as (
    text: string,
    options: { from: string; to: string },
  ) => Promise<{ text: string }>;
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")) as Catalog;
  const entries = Object.entries(catalog).filter(([, value]) =>
    shouldTranslate(value["pt-BR"], value["en-US"]),
  );

  let translated = 0;
  let failed = 0;
  const concurrency = Math.max(1, Math.min(6, Number(process.env.POPLOG_UI_TRANSLATE_CONCURRENCY ?? 4)));
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const [key, value] = entries[cursor++];
      try {
        value["en-US"] = await translateText(translate, value["pt-BR"]);
        translated += 1;
      } catch (error) {
        failed += 1;
        console.warn("[ui-translate] failed", key, error instanceof Error ? error.message : String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log("[ui-translate]", { candidates: entries.length, translated, failed });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[ui-translate] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
