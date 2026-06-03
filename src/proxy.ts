import { createServerClient } from "@supabase/ssr";
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
  // Com POPLOG_LOCAL_AUTH_ENABLED=true: libera todas as rotas protegidas sem Supabase.
  if (isLocalAuthActive()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route),
  );

  const session = await auth();
  if (!isProtectedRoute || session?.user?.id) {
    return response;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
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
