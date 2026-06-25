import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import type { LegalConsentRecord } from "@/lib/legal/consent-storage";

function isConsentRecord(value: unknown): value is LegalConsentRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LegalConsentRecord>;
  return (
    record.schemaVersion === 1 &&
    typeof record.anonymousId === "string" &&
    record.anonymousId.length >= 12 &&
    typeof record.terms === "object" &&
    typeof record.cookies === "object"
  );
}

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ ok: true, source: "anonymous", consent: null });
  }

  try {
    const consent = await db.userLegalConsent.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ ok: true, source: "database", consent: consent?.record ?? null });
  } catch (error) {
    console.warn("[legal/consent] read failed", error);
    return NextResponse.json({ ok: true, source: "unavailable", consent: null });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!isConsentRecord(body)) {
    return NextResponse.json({ ok: false, error: "Invalid consent record" }, { status: 400 });
  }

  const user = await getCurrentUser().catch(() => null);
  const record: LegalConsentRecord = {
    ...body,
    subjectId: user?.id ?? body.subjectId ?? null,
    audit: { ...body.audit, storage: "database", lastSyncedAt: new Date().toISOString() },
  };

  try {
    await db.userLegalConsent.upsert({
      where: { anonymousId: record.anonymousId },
      create: {
        anonymousId: record.anonymousId,
        userId: user?.id ?? null,
        schemaVersion: 1,
        termsAccepted: record.terms.accepted,
        termsVersion: record.terms.version,
        privacyAccepted: record.privacy.accepted,
        privacyVersion: record.privacy.version,
        analyticsEnabled: record.cookies.analytics.enabled,
        adsEnabled: record.cookies.ads.enabled,
        personalizationEnabled: record.cookies.personalization.enabled,
        interfaceLanguage: record.locale.interfaceLanguage,
        region: record.locale.region,
        source: record.terms.source ?? null,
        record,
      },
      update: {
        userId: user?.id ?? null,
        termsAccepted: record.terms.accepted,
        termsVersion: record.terms.version,
        privacyAccepted: record.privacy.accepted,
        privacyVersion: record.privacy.version,
        analyticsEnabled: record.cookies.analytics.enabled,
        adsEnabled: record.cookies.ads.enabled,
        personalizationEnabled: record.cookies.personalization.enabled,
        interfaceLanguage: record.locale.interfaceLanguage,
        region: record.locale.region,
        source: record.terms.source ?? null,
        record,
      },
    });
    return NextResponse.json({ ok: true, persisted: true, subjectId: record.subjectId });
  } catch (error) {
    // The table may not be migrated yet in this environment; the client keeps
    // localStorage as the source of truth, so we degrade gracefully.
    console.warn("[legal/consent] persist failed", error);
    return NextResponse.json({ ok: true, persisted: false });
  }
}
