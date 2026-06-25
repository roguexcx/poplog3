import "dotenv/config";

import assert from "node:assert/strict";

if (process.argv.includes("--s3-local")) {
  process.env.POPLOG_STORAGE_DRIVER = "s3";
  process.env.POPLOG_S3_ENDPOINT = process.env.POPLOG_S3_ENDPOINT || "http://127.0.0.1:9000";
  process.env.POPLOG_S3_REGION = process.env.POPLOG_S3_REGION || "us-east-1";
  process.env.POPLOG_S3_BUCKET = process.env.POPLOG_S3_BUCKET || "poplog-assets";
  process.env.POPLOG_S3_ACCESS_KEY_ID = process.env.POPLOG_S3_ACCESS_KEY_ID || "poplog_minio";
  process.env.POPLOG_S3_SECRET_ACCESS_KEY = process.env.POPLOG_S3_SECRET_ACCESS_KEY || "poplog_minio_secret";
  process.env.POPLOG_S3_FORCE_PATH_STYLE = process.env.POPLOG_S3_FORCE_PATH_STYLE || "true";
  process.env.POPLOG_ASSET_PUBLIC_BASE_URL = process.env.POPLOG_ASSET_PUBLIC_BASE_URL || "http://127.0.0.1:9000/poplog-assets";
}

import { getStorageProvider } from "@/server/source-engine/storage";

async function main() {
  const storage = getStorageProvider();
  const key = `posters/tt0000000/pt-BR/regression-${Date.now()}.webp`;
  const buffer = Buffer.from("poplog-local-asset-smoke");

  const write = await storage.write({
    assetKey: key,
    buffer,
    contentType: "image/webp",
  });
  assert.equal(write.assetKey, key, "assetKey preservado");
  assert.ok(write.publicUrl, "URL publica resolvida");
  assert.equal(await storage.exists(key), true, "asset existe apos escrita");

  const stored = await storage.read(key);
  assert.ok(stored, "asset lido do storage");
  assert.equal(stored?.contentType, "image/webp", "content-type preservado");
  assert.equal(stored?.buffer.toString(), buffer.toString(), "conteudo preservado");

  if (/^https?:\/\//i.test(write.publicUrl)) {
    const publicResponse = await fetch(write.publicUrl);
    assert.equal(publicResponse.status, 200, "URL publica do asset responde");
    assert.equal(await publicResponse.text(), buffer.toString(), "URL publica retorna conteudo esperado");
  }

  assert.equal(await storage.delete(key), true, "asset removido");
  assert.equal(await storage.exists(key), false, "asset inexistente apos delete");

  console.log("[smoke:assets-local] ok", {
    provider: storage.kind,
    assetKey: key,
    publicUrl: write.publicUrl,
  });
}

main().catch((error) => {
  console.error("[smoke:assets-local] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
