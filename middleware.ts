import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

/**
 * Gate the app pages behind a valid session. Runs on the edge; uses the
 * isomorphic Web-Crypto verify in lib/session.ts (no node:crypto). API routes
 * enforce their own 401s, so they are intentionally NOT matched here.
 * `/admin` additionally requires an admin email (allowlist).
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);

  if (payload) {
    // Admin area needs an admin session; non-admins go to the workspace.
    if (req.nextUrl.pathname.startsWith("/admin") && !isAdminEmail(payload.email)) {
      const url = req.nextUrl.clone();
      url.pathname = "/workspace";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/workspace/:path*", "/projects/:path*", "/admin/:path*"],
};
