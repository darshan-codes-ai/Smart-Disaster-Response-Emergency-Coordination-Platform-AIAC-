import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response = NextResponse.next({ request });
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const isProtectedRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname === "/incidents" ||
    request.nextUrl.pathname.startsWith("/incidents/") ||
    request.nextUrl.pathname === "/command" ||
    request.nextUrl.pathname.startsWith("/command/") ||
    request.nextUrl.pathname === "/responder" ||
    request.nextUrl.pathname.startsWith("/responder/");

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/incidents",
    "/incidents/:path*",
    "/command",
    "/command/:path*",
    "/responder",
    "/responder/:path*",
    "/login",
  ],
};
