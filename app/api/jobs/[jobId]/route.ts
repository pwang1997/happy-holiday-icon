import {
  getSubmissionAuth,
  imageJobOwner,
  SubmissionAuthenticationError,
} from "@/app/lib/auth-service";
import { errorResponse } from "@/app/lib/http-responses";
import {
  imageJobService,
  ImageJobServiceError,
} from "@/app/lib/image-job-service";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  let submissionAuth;

  try {
    submissionAuth = await getSubmissionAuth(request);
  } catch (error) {
    if (error instanceof SubmissionAuthenticationError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to resolve job authentication", error);
    return errorResponse("Authentication is not configured.", 503);
  }

  try {
    return Response.json(
      await imageJobService.getImageJobStatus(
        jobId,
        imageJobOwner(submissionAuth.identity),
      ),
    );
  } catch (error) {
    if (error instanceof ImageJobServiceError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to read image job", error);
    return errorResponse("Unable to read the image job.", 503);
  }
}
