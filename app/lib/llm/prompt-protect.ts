import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { VALIDATION_SYSTEM_PROMPT } from "../instructions";

const PROMPT_VALIDATION_TIMEOUT_MS = 5_000;

export const PROMPT_VALIDATION_MODEL_CONFIG = {
  maxRetries: 0,
  maxTokens: 100,
  model: "gpt-5.6-luna",
  timeout: PROMPT_VALIDATION_TIMEOUT_MS,
} as const;

export class PromptValidationRejectedError extends Error {
  constructor() {
    super("The prompt validator rejected the submission.");
    this.name = "PromptValidationRejectedError";
  }
}

export class PromptValidationServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PromptValidationServiceError";
  }
}

export function isPromptValidationPass(content: unknown) {
  return typeof content === "string" && content.trim().toUpperCase() === "PASS";
}

export function isPromptValidationRejection(content: unknown) {
  return typeof content === "string" && content.trim().toUpperCase() === "FAIL";
}

export function promptValidationOutcome(content: unknown) {
  if (isPromptValidationPass(content)) {
    return "pass";
  }

  if (isPromptValidationRejection(content)) {
    return "reject";
  }

  throw new PromptValidationServiceError(
    "The prompt validation service returned an invalid result.",
  );
}

export default class PromptProtectProvider {
  private readonly model: ChatOpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new PromptValidationServiceError(
        "The prompt validator is not configured.",
      );
    }

    this.model = new ChatOpenAI({
      apiKey,
      ...PROMPT_VALIDATION_MODEL_CONFIG,
    });
  }

  async validate(basePrompt: string, userPrompt: string): Promise<void> {
    const template = ChatPromptTemplate.fromMessages([
      ["system", VALIDATION_SYSTEM_PROMPT],
      [
        "human",
        `<trusted_base_prompt>\n{basePrompt}\n</trusted_base_prompt>\n\n<untrusted_user_text>\n{userPrompt}\n</untrusted_user_text>`,
      ],
    ]);

    const promptValue = await template.invoke({ basePrompt, userPrompt });

    let response: Awaited<ReturnType<ChatOpenAI["invoke"]>>;

    try {
      response = await this.model.invoke(promptValue);
    } catch (error) {
      throw new PromptValidationServiceError(
        "The prompt validation service is unavailable.",
        { cause: error },
      );
    }

    const outcome = promptValidationOutcome(response.content);

    if (outcome === "pass") {
      return;
    }

    throw new PromptValidationRejectedError();
  }
}
