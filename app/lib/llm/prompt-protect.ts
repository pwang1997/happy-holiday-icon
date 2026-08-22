import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { VALIDATION_SYSTEM_PROMPT } from "../instructions";

export function isPromptValidationPass(content: unknown) {
  return typeof content === "string" && content.trim().toUpperCase() === "PASS";
}

export default class PromptProtectProvider {
  private readonly model: ChatOpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw Error(
        "The prompt validator is not configured. Add OPENAI_API_KEY to the server environment.",
      );
    }

    this.model = new ChatOpenAI({
      apiKey,
      model: "gpt-5.6-luna",
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
    const response = await this.model.invoke(promptValue);
    if (!isPromptValidationPass(response.content)) {
      throw new Error("The prompt validator rejected the submission.");
    }
  }
}
