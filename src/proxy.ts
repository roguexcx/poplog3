import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth/next-auth";

const PROTECTED_ROUTES = [
  "/acompanhando",
  "/admin",
  "/debug",
  "/library",
  "/profile",
  "/settings",
  "/sorteio",
];

function isLocalAuthActive(): boolean {
  const v = process.env.POPLOG_LOCAL_AUTH_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export async function proxy(request: NextRequest) {
  if (isLocalAuthActive()) {
    return NextResponse.next({ request });
  }

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route),
  );

  const session = await auth();
  if (!isProtectedRoute || session?.user?.id) {
    return NextResponse.next({ request });
  }

  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: [
    "/acompanhando/:path*",
    "/admin/:path*",
    "/debug/:path*",
    "/library/:path*",
    "/profile/:path*",
    "/settings/:path*",
    "/sorteio/:path*",
  ],
};
