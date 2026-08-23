import { NextResponse } from "next/server";

export function errorResponse(
  message: string,
  status: number,
  headers?: HeadersInit,
) {
  return NextResponse.json({ error: message }, { headers, status });
}
