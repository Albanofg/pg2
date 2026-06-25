import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Gate the app pages behind a valid session. Runs on the edge; uses the
 * isomorphic Web-Crypto verify in lib/session.ts (no node:crypto). API routes
 * enforce their own 401s, so they are intentionally NOT matched here.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySession(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/workspace/:path*", "/projects/:path*"],
};
