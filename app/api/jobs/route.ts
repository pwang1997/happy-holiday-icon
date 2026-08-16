import { errorResponse } from "@/app/lib/http-responses";
import {
  imageJobService,
  ImageJobServiceError,
} from "@/app/lib/image-job-service";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be JSON.", 400);
  }

  try {
    const job = await imageJobService.createImageUploadJob(payload);
    return Response.json(job, { status: 201 });
  } catch (error) {
    if (error instanceof ImageJobServiceError) {
      return errorResponse(error.message, error.status);
    }

    console.error("Unable to create image job", error);
    return errorResponse("Unable to create an image job.", 503);
  }
}
