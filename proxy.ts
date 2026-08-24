import { NextResponse, type NextRequest } from "next/server";

const TRUSTED_PROXY_TOKEN_HEADER = "x-submission-proxy-token";

export function proxy(request: NextRequest) {
  const secret = process.env.SUBMISSION_GUARD_SECRET?.trim();

  if (!secret) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TRUSTED_PROXY_TOKEN_HEADER, secret);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: "/api/submit",
};
