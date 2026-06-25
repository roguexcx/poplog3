import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
  normalizeInterfaceLanguage,
} from "@/server/source-engine/locale";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function localeFromCookies(request: NextRequest) {
  return {
    interfaceLanguage: normalizeInterfaceLanguage(request.cookies.get("poplog_interface_language")?.value),
    catalogLanguage: normalizeCatalogLanguage(request.cookies.get("poplog_catalog_language")?.value),
    region: normalizeCatalogRegion(request.cookies.get("poplog_region")?.value),
  };
}

function setLocaleCookies(response: NextResponse, locale: ReturnType<typeof localeFromCookies>) {
  response.cookies.set("poplog_interface_language", locale.interfaceLanguage, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  response.cookies.set("poplog_catalog_language", locale.catalogLanguage, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  response.cookies.set("poplog_region", locale.region, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}

export async function GET(request: NextRequest) {
  const cookieLocale = localeFromCookies(request);
  const user = await getCurrentUser().catch(() => null);

  if (!user) {
    return NextResponse.json({ ok: true, source: "cookie", locale: cookieLocale });
  }

  const preference = await db.userCuradoriaPreference.findUnique({
    where: { userId: user.id },
    select: {
      interfaceLanguage: true,
      catalogLanguage: true,
      availabilityRegion: true,
    },
  }).catch(() => null);

  const locale = preference
    ? {
        interfaceLanguage: normalizeInterfaceLanguage(preference.interfaceLanguage),
        catalogLanguage: normalizeCatalogLanguage(preference.catalogLanguage),
        region: normalizeCatalogRegion(preference.availabilityRegion),
      }
    : cookieLocale;

  const response = NextResponse.json({ ok: true, source: preference ? "profile" : "cookie", locale });
  setLocaleCookies(response, locale);
  return response;
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    interfaceLanguage?: string | null;
    catalogLanguage?: string | null;
    language?: string | null;
    region?: string | null;
  };

  const locale = {
    interfaceLanguage: normalizeInterfaceLanguage(body.interfaceLanguage ?? body.language),
    catalogLanguage: normalizeCatalogLanguage(body.catalogLanguage ?? body.language),
    region: normalizeCatalogRegion(body.region),
  };
  const user = await getCurrentUser().catch(() => null);

  if (user) {
    await db.userCuradoriaPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        interfaceLanguage: locale.interfaceLanguage,
        catalogLanguage: locale.catalogLanguage,
        availabilityRegion: locale.region,
      },
      update: {
        interfaceLanguage: locale.interfaceLanguage,
        catalogLanguage: locale.catalogLanguage,
        availabilityRegion: locale.region,
      },
    });
  }

  const response = NextResponse.json({
    ok: true,
    source: user ? "profile" : "cookie",
    locale,
  });
  setLocaleCookies(response, locale);
  return response;
}
