import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI, tools } from "@langchain/openai";
import { getImageDownloadUrl, uploadImage } from "@/app/lib/s3";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 500;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const STYLE_INSTRUCTIONS = {
  playful: "Use a playful, hand-drawn illustration style with warm, friendly shapes.",
  minimal: "Use a minimal, clean style with simple geometry and plenty of negative space.",
  vintage: "Use a vintage holiday postcard style with softly textured, nostalgic colors.",
  festive: "Use a bright, festive style with joyful colors and celebratory details.",
} as const;

type Style = keyof typeof STYLE_INSTRUCTIONS;

type ImageGenerationOutput = {
  type?: string;
  result?: string;
  revised_prompt?: string;
};

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function isStyle(value: string): value is Style {
  return Object.prototype.hasOwnProperty.call(STYLE_INSTRUCTIONS, value);
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return errorResponse(
      "The image generator is not configured. Add OPENAI_API_KEY to the server environment.",
      503,
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return errorResponse("The form submission could not be read.", 400);
  }

  const imageValue = formData.get("image");
  const promptValue = formData.get("prompt");
  const styleValue = formData.get("style");

  if (!(imageValue instanceof File) || imageValue.size === 0) {
    return errorResponse("Please upload an image.", 400);
  }

  if (!ALLOWED_IMAGE_TYPES.has(imageValue.type)) {
    return errorResponse("Only PNG, JPG, and WEBP images are supported.", 415);
  }

  if (imageValue.size > MAX_IMAGE_SIZE_BYTES) {
    return errorResponse("The image must be 10 MB or smaller.", 413);
  }

  if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
    return errorResponse("Please describe the icon you want to create.", 400);
  }

  const prompt = promptValue.trim();

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse(
      `The description must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      400,
    );
  }

  if (typeof styleValue !== "string" || !isStyle(styleValue)) {
    return errorResponse("Please choose a supported style.", 400);
  }

  const imageBytes = await imageValue.arrayBuffer();
  const base64Image = Buffer.from(imageBytes).toString("base64");
  const imageDataUrl = `data:${imageValue.type};base64,${base64Image}`;
  const styleInstruction = STYLE_INSTRUCTIONS[styleValue];

  const instruction = [
    "Edit the uploaded reference image into a single holiday app icon.",
    `The requested subject or direction is: ${prompt}`,
    `The requested visual style is: ${styleInstruction}`,
    "Keep the main subject recognizable, centered, and legible at small sizes.",
    "Use a square composition, a clean silhouette, and no text or watermark.",
    "Return the finished icon as a PNG with a transparent background when possible.",
  ].join("\n");

  try {
    const model = new ChatOpenAI({
      apiKey,
      // This is the text-capable main model that invokes the image tool.
      // GPT Image models belong in tools.imageGeneration(), not here.
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
    });

    const response = await model.invoke(
      [
        new HumanMessage({
          content: [
            { type: "text", text: instruction },
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        }),
      ],
      {
        tools: [
          tools.imageGeneration({
            action: "edit",
            background: "transparent",
            inputFidelity: "high",
            // Keep transparency enabled; newer image models may reject it.
            model: "gpt-image-1",
            outputFormat: "png",
            quality: "medium",
            size: "1024x1024",
          }),
        ],
        tool_choice: { type: "image_generation" },
      },
    );

    const toolOutputs = response.additional_kwargs?.tool_outputs;
    const imageOutput = Array.isArray(toolOutputs)
      ? (toolOutputs.find(
          (output): output is ImageGenerationOutput =>
            typeof output === "object" &&
            output !== null &&
            "type" in output &&
            output.type === "image_generation_call",
        ) as ImageGenerationOutput | undefined)
      : undefined;

    if (!imageOutput?.result) {
      console.error("OpenAI did not return an image");
      return errorResponse("The image generator did not return an image.", 502);
    }

    const imageKey = `images/${crypto.randomUUID()}-holiday-icon.png`;

    let imageUrl: string;

    try {
      await uploadImage({
        key: imageKey,
        body: Buffer.from(imageOutput.result, "base64"),
        contentType: "image/png",
      });

      imageUrl = await getImageDownloadUrl(imageKey);
    } catch (error) {
      console.error("Generated image could not be saved to S3", error);
      return errorResponse(
        "The generated image could not be saved. Please try again.",
        502,
      );
    }

    return Response.json({
      imageUrl,
      imageKey,
      revisedPrompt: imageOutput.revised_prompt ?? null,
    });
  } catch (error) {
    console.error("Image generation failed", error);
    return errorResponse("Image generation failed. Please try again.", 502);
  }
}
