import { authenticateRequest } from "@/app/lib/cognito";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const authentication = await authenticateRequest(request);

    if (authentication.kind === "invalid") {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 },
      );
    }

    return NextResponse.json({
      authenticated: authentication.kind === "authenticated",
    });
  } catch (error) {
    console.error("Unable to read authentication session", error);
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }
}
