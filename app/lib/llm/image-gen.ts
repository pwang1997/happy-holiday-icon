import { STYLE_INSTRUCTIONS, type Style } from "@/app/lib/instructions";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI, tools } from "@langchain/openai";

export type ImageGenerationRequest = {
  imageDataUrl: string;
  prompt: string;
  style: Style;
};

export type GeneratedImage = {
  imageBase64: string;
  revisedPrompt: string | null;
};

type ImageGenerationOutput = {
  type?: string;
  result?: string;
  revised_prompt?: string;
};

export class ImageGenerationConfigurationError extends Error {
  constructor() {
    super(
      "The image generator is not configured. Add OPENAI_API_KEY to the server environment.",
    );
    this.name = "ImageGenerationConfigurationError";
  }
}

function generatedImageFromResponse(response: {
  additional_kwargs?: Record<string, unknown>;
}): GeneratedImage {
  const toolOutputs = response.additional_kwargs?.tool_outputs;
  const imageOutput = Array.isArray(toolOutputs)
    ? toolOutputs.find(
        (output): output is ImageGenerationOutput =>
          typeof output === "object" &&
          output !== null &&
          "type" in output &&
          output.type === "image_generation_call",
      )
    : undefined;

  if (!imageOutput?.result) {
    throw new Error("The image generator did not return an image.");
  }

  return {
    imageBase64: imageOutput.result,
    revisedPrompt:
      typeof imageOutput.revised_prompt === "string"
        ? imageOutput.revised_prompt
        : null,
  };
}

export default class ImageGenProvider {
  private readonly model: ChatOpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new ImageGenerationConfigurationError();
    }

    this.model = new ChatOpenAI({
      apiKey,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
    });
  }

  async generate({
    style,
    imageDataUrl,
    prompt,
  }: ImageGenerationRequest): Promise<GeneratedImage> {
    const instruction = [
      "Edit the uploaded reference image into a single holiday app icon.",
      `The requested subject or direction is: ${prompt}`,
      `The requested visual style is: ${STYLE_INSTRUCTIONS[style]}`,
      "Keep the main subject recognizable, centered, and legible at small sizes.",
      "Use a square composition, a clean silhouette, and no text or watermark.",
      "Return the finished icon as a PNG with a transparent background when possible.",
    ].join("\n");

    const response = await this.model.invoke(
      [
        new HumanMessage({
          content: [
            { type: "text", text: instruction },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        }),
      ],
      {
        tools: [
          tools.imageGeneration({
            action: "edit",
            background: "transparent",
            inputFidelity: "high",
            model: "gpt-image-1",
            outputFormat: "png",
            quality: "medium",
            size: "1024x1024",
          }),
        ],
        tool_choice: { type: "image_generation" },
      },
    );

    return generatedImageFromResponse(response);
  }
}
