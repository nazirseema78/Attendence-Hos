import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for visitors with no session cookie, so they land on the login page
 * instead of a loading screen. This is NOT the security check: every page, Server Action and
 * Route Handler verifies the session against the database itself.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    if (pathname !== "/admin/login" && !request.cookies.has("ah_admin")) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/" && !request.cookies.has("ah_student")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
