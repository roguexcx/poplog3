import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    return NextResponse.json(
      {
        ok: false,
        error: "Supabase env ausente",
      },
      {
        status: 500,
      }
    );
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/poplog3_titles?select=tmdb_id&limit=1`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`,
        },
      }
    );

    const data = await response.json();

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      service: "supabase",
      rowsReturned: Array.isArray(data)
        ? data.length
        : 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "supabase",
        error:
          error instanceof Error
            ? error.message
            : "unknown_error",
      },
      {
        status: 500,
      }
    );
  }
}
