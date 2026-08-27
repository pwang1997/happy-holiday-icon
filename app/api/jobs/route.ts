import { imageJobOwner } from "@/app/lib/auth-service";
import { authenticateRequest } from "@/app/lib/cognito";
import { errorResponse } from "@/app/lib/http-responses";
import {
  imageJobService,
  ImageJobServiceError,
} from "@/app/lib/image-job-service";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  let authentication;

  try {
    authentication = await authenticateRequest(request);
  } catch (error) {
    console.error("Unable to verify dashboard authentication", error);
    return errorResponse("Authentication is not configured.", 503);
  }

  if (authentication.kind !== "authenticated") {
    return errorResponse("Please sign in to view your runs.", 401);
  }

  try {
    return Response.json(
      await imageJobService.listImageJobsForOwner(
        imageJobOwner(authentication),
      ),
    );
  } catch (error) {
    if (error instanceof ImageJobServiceError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to list image jobs", error);
    return errorResponse("Unable to load your runs.", 503);
  }
}
