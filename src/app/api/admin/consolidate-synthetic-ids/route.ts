import { NextResponse } from "next/server";
import {
  findSyntheticDuplicates,
  consolidateSyntheticToReal,
} from "@/server/repositories/title-consolidation.repository";
import type { MediaType } from "@prisma/client";

function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

// GET — lista duplicatas sintético/real existentes no banco
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mediaType = url.searchParams.get("mediaType") as MediaType | null;

  const duplicates = await findSyntheticDuplicates(mediaType ?? undefined);

  return NextResponse.json({
    count: duplicates.length,
    duplicates,
  });
}

// POST — executa consolidação bulk de todos os duplicatas encontrados
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const mediaType = url.searchParams.get("mediaType") as MediaType | null;
  const dryRun = url.searchParams.get("dry") === "1";

  const duplicates = await findSyntheticDuplicates(mediaType ?? undefined);

  if (dryRun) {
    return NextResponse.json({ dryRun: true, count: duplicates.length, duplicates });
  }

  const results = await Promise.allSettled(
    duplicates.map((dup) =>
      consolidateSyntheticToReal(dup.syntheticTmdbId, dup.realTmdbId, dup.mediaType).then(
        (result) => ({ ...dup, result }),
      ),
    ),
  );

  const summary = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: String(r.reason) },
  );

  const merged = summary.filter((s) => "result" in s && s.result.merged).length;
  const failed = summary.filter((s) => "result" in s && !s.result.merged).length;

  return NextResponse.json({
    processed: duplicates.length,
    merged,
    failed,
    summary,
  });
}
