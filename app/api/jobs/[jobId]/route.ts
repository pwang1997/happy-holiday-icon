import { errorResponse } from "@/app/lib/http-responses";
import {
  imageJobService,
  ImageJobServiceError,
} from "@/app/lib/image-job-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;

  try {
    return Response.json(await imageJobService.getImageJobStatus(jobId));
  } catch (error) {
    if (error instanceof ImageJobServiceError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to read image job", error);
    return errorResponse("Unable to read the image job.", 503);
  }
}
